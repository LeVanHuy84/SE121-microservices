"""Public API v1 for the frontend (reached through the gateway). See chatbot-api-contract.md.

- Auth: `X-Internal-Key` (gateway -> service) + `X-User-Id` (set by the gateway from the JWT).
  Clients must NOT send userId/history/contexts: the service resolves them from memory/Mongo/RAG.
- camelCase JSON, envelope `{success, data}` / `{success:false, error:{code, message}}`.
- Internal fields `model/provider/latencyMs/persisted` are never exposed.
- SSE uses named events: `chunk`, `done`, `error`.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import AsyncIterator, Literal, Optional

from fastapi import APIRouter, Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings as core_settings
from app.modules.chatbot.repositories.chat_history import ClearHistoryCommand, GetHistoryQuery
from app.modules.chatbot.schemas import (
    AssistantRespondRequest,
    AssistantResponseType,
    AssistantSource,
    CrisisInfo,
)
from app.modules.chatbot.services.assistant import RespondCommand

logger = logging.getLogger("uvicorn.error")

API_PREFIX = "/v1/assistant"
MAX_MESSAGE_CHARS = 4000

public_router = APIRouter(prefix=API_PREFIX, tags=["assistant-v1"])
respond_command = RespondCommand()
get_history_query = GetHistoryQuery()
clear_history_command = ClearHistoryCommand()


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"success": False, "error": {"code": code, "message": message}},
    )


def _is_public_path(request: Request) -> bool:
    return request.url.path.startswith("/v1/")


def register_public_error_handlers(app: FastAPI) -> None:
    """Apply the error envelope to /v1 paths only; other endpoints keep their existing behavior."""

    @app.exception_handler(ApiError)
    async def _api_error_handler(_: Request, exc: ApiError):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        if _is_public_path(request):
            return error_response(400, "INVALID_REQUEST", "Request is invalid.")
        from fastapi.exception_handlers import request_validation_exception_handler

        return await request_validation_exception_handler(request, exc)

    @app.exception_handler(StarletteHTTPException)
    async def _http_handler(request: Request, exc: StarletteHTTPException):
        if _is_public_path(request):
            code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
            return error_response(exc.status_code, code, "Request could not be processed.")
        from fastapi.exception_handlers import http_exception_handler

        return await http_exception_handler(request, exc)


# --------------------------------------------------------------------------
# Auth
# --------------------------------------------------------------------------
def require_gateway_user(
    x_internal_key: Optional[str] = Header(default=None),
    x_user_id: Optional[str] = Header(default=None),
) -> str:
    if not x_internal_key or x_internal_key != core_settings.INTERNAL_SERVICE_KEY:
        raise ApiError(403, "FORBIDDEN", "Access denied.")
    user_id = (x_user_id or "").strip()
    if not user_id:
        raise ApiError(401, "UNAUTHENTICATED", "User is not authenticated.")
    return user_id


# --------------------------------------------------------------------------
# Schemas (camelCase)
# --------------------------------------------------------------------------
class PublicRespondRequest(BaseModel):
    message: str = Field(max_length=MAX_MESSAGE_CHARS)
    conversationId: Optional[str] = Field(default=None, max_length=128)
    clientMessageId: Optional[str] = Field(default=None, max_length=128)
    intent: Optional[str] = Field(default=None, max_length=64)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("message must not be blank")
        return stripped


class PublicAnswer(BaseModel):
    type: AssistantResponseType
    reply: str
    sources: list[AssistantSource] = Field(default_factory=list)
    requestId: Optional[str] = None
    conversationId: Optional[str] = None
    crisis: Optional[CrisisInfo] = None


class PublicRespondResponse(BaseModel):
    success: Literal[True] = True
    data: PublicAnswer


class PublicHistoryItem(BaseModel):
    id: str
    conversationId: str
    role: str
    content: str
    intent: Optional[str] = None
    sources: list[AssistantSource] = Field(default_factory=list)
    createdAt: datetime


class PublicNextCursor(BaseModel):
    createdAt: datetime
    id: str


class PublicHistoryPage(BaseModel):
    items: list[PublicHistoryItem] = Field(default_factory=list)
    nextCursor: Optional[PublicNextCursor] = None
    hasMore: bool = False


class PublicHistoryResponse(BaseModel):
    success: Literal[True] = True
    data: PublicHistoryPage


class PublicClearData(BaseModel):
    deletedCount: int
    sessionCleared: bool


class PublicClearResponse(BaseModel):
    success: Literal[True] = True
    data: PublicClearData


def _to_internal(req: PublicRespondRequest, user_id: str) -> AssistantRespondRequest:
    # history/contexts are always empty: the service resolves them from memory/Mongo/RAG.
    return AssistantRespondRequest(
        userId=user_id,
        message=req.message,
        conversationId=req.conversationId,
        clientMessageId=req.clientMessageId,
        intent=req.intent,
    )


# --------------------------------------------------------------------------
# Endpoints
# --------------------------------------------------------------------------
@public_router.post("/respond", response_model=PublicRespondResponse)
async def respond(req: PublicRespondRequest, user_id: str = Depends(require_gateway_user)):
    try:
        data = await respond_command.execute(_to_internal(req, user_id))
    except Exception as exc:
        logger.exception("Assistant v1 respond failed: userId=%s", user_id)
        raise ApiError(
            502,
            "ASSISTANT_GENERATION_FAILED",
            "Assistant could not complete this request.",
        ) from exc
    return PublicRespondResponse(
        data=PublicAnswer(
            type=data.type,
            reply=data.reply,
            sources=data.sources,
            requestId=data.requestId,
            conversationId=data.conversationId,
            crisis=data.crisis,
        )
    )


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


_STREAM_ERROR = {
    "code": "ASSISTANT_STREAM_FAILED",
    "message": "Assistant could not complete this request.",
}


async def _stream_events(internal: AssistantRespondRequest) -> AsyncIterator[str]:
    sources: list[AssistantSource] = []
    last = None
    try:
        async for data in respond_command.execute_stream(internal):
            if data.model == "error-guard":
                yield _sse("error", _STREAM_ERROR)
                return
            last = data
            if data.sources and not sources:
                sources = data.sources
            yield _sse("chunk", {"delta": data.reply})
    except Exception:
        logger.exception("Assistant v1 stream failed: userId=%s", internal.userId)
        yield _sse("error", _STREAM_ERROR)
        return

    if last is None:
        yield _sse("error", _STREAM_ERROR)
        return

    yield _sse(
        "done",
        {
            "type": last.type,
            "sources": [s.model_dump(mode="json") for s in sources],
            "requestId": last.requestId,
            "conversationId": last.conversationId,
            "crisis": last.crisis.model_dump(mode="json") if last.crisis else None,
        },
    )


@public_router.post("/respond-stream")
async def respond_stream(req: PublicRespondRequest, user_id: str = Depends(require_gateway_user)):
    return StreamingResponse(
        _stream_events(_to_internal(req, user_id)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@public_router.get("/history/me", response_model=PublicHistoryResponse)
async def get_my_history(
    user_id: str = Depends(require_gateway_user),
    pageSize: Optional[int] = Query(default=None, ge=1),
    beforeCreatedAt: Optional[datetime] = None,
    beforeId: Optional[str] = None,
):
    try:
        page = await get_history_query.execute(
            user_id=user_id,
            page_size=pageSize,
            before_created_at=beforeCreatedAt,
            before_id=beforeId,
        )
    except ValueError as exc:
        raise ApiError(400, "INVALID_HISTORY_CURSOR", "History cursor is invalid.") from exc
    except RuntimeError as exc:
        raise ApiError(503, "CHAT_HISTORY_DISABLED", "Chat history is unavailable.") from exc
    except Exception as exc:
        logger.exception("Assistant v1 history failed: userId=%s", user_id)
        raise ApiError(
            502, "ASSISTANT_HISTORY_FAILED", "Assistant history could not be loaded."
        ) from exc

    next_cursor = None
    if page.next_cursor_created_at and page.next_cursor_id:
        next_cursor = PublicNextCursor(
            createdAt=page.next_cursor_created_at,
            id=page.next_cursor_id,
        )
    return PublicHistoryResponse(
        data=PublicHistoryPage(
            items=[
                PublicHistoryItem(
                    id=item.id,
                    conversationId=item.conversation_id,
                    role=item.role,
                    content=item.content,
                    intent=item.intent,
                    sources=item.sources,
                    createdAt=item.created_at,
                )
                for item in page.items
            ],
            nextCursor=next_cursor,
            hasMore=page.has_more,
        )
    )


@public_router.delete("/history/me", response_model=PublicClearResponse)
async def clear_my_history(user_id: str = Depends(require_gateway_user)):
    try:
        deleted = await clear_history_command.execute(user_id)
    except RuntimeError as exc:
        raise ApiError(503, "CHAT_HISTORY_DISABLED", "Chat history is unavailable.") from exc
    except Exception as exc:
        logger.exception("Assistant v1 history clear failed: userId=%s", user_id)
        raise ApiError(
            502, "ASSISTANT_HISTORY_CLEAR_FAILED", "Assistant history could not be cleared."
        ) from exc
    return PublicClearResponse(data=PublicClearData(deletedCount=deleted, sessionCleared=True))
