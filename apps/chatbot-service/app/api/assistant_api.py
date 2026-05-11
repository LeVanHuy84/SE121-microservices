import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query

from app.commands.assistant import RespondCommand
from app.core.security import verify_internal_key
from app.queries.assistant import ClearHistoryCommand, GetHistoryQuery
from app.schemas.assistant_schema import (
    AssistantHistoryClearData,
    AssistantHistoryClearResponse,
    AssistantHistoryPageResponse,
    AssistantRespondRequest,
    AssistantRespondResponse,
)

assistant_router = APIRouter(prefix="/assistant")
logger = logging.getLogger("uvicorn.error")
respond_command = RespondCommand()
get_history_query = GetHistoryQuery()
clear_history_command = ClearHistoryCommand()


def _stable_client_error(
    status: int,
    code: str,
    message: str,
) -> dict[str, str | int]:
    return {
        "statusCode": status,
        "code": code,
        "message": message,
    }


@assistant_router.post(
    "/respond",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantRespondResponse,
)
async def respond(req: AssistantRespondRequest):
    try:
        data = await respond_command.execute(req)
        return AssistantRespondResponse(success=True, data=data)
    except Exception as exc:
        logger.exception(
            "Assistant response failed: userId=%s conversationId=%s",
            req.userId,
            req.conversationId,
        )
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(
                502,
                "ASSISTANT_GENERATION_FAILED",
                "Assistant could not complete this request.",
            ),
        ) from exc


@assistant_router.get(
    "/history/{user_id}",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantHistoryPageResponse,
)
async def get_history_by_user(
    user_id: str,
    page_size: int | None = Query(default=None, ge=1),
    before_created_at: datetime | None = None,
    before_id: str | None = None,
):
    try:
        data = await get_history_query.execute(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
        )
        return AssistantHistoryPageResponse(success=True, data=data)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=_stable_client_error(400, "INVALID_HISTORY_CURSOR", str(exc)),
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=_stable_client_error(
                503,
                "CHAT_HISTORY_DISABLED",
                str(exc),
            ),
        ) from exc
    except Exception as exc:
        logger.exception("Assistant history query failed: userId=%s", user_id)
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(
                502,
                "ASSISTANT_HISTORY_FAILED",
                "Assistant history could not be loaded.",
            ),
        ) from exc


@assistant_router.delete(
    "/history/{user_id}",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantHistoryClearResponse,
)
async def clear_history_by_user(user_id: str):
    try:
        deleted_count = await clear_history_command.execute(user_id)
        return AssistantHistoryClearResponse(
            success=True,
            data=AssistantHistoryClearData(
                deleted_count=deleted_count,
                session_cleared=True,
            ),
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=503,
            detail=_stable_client_error(
                503,
                "CHAT_HISTORY_DISABLED",
                str(exc),
            ),
        ) from exc
    except Exception as exc:
        logger.exception("Assistant history clear failed: userId=%s", user_id)
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(
                502,
                "ASSISTANT_HISTORY_CLEAR_FAILED",
                "Assistant history could not be cleared.",
            ),
        ) from exc
