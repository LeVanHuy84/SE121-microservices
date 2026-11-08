import logging
import json
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.modules.chatbot.services.assistant import RespondCommand
from app.core.security import verify_internal_key
from app.modules.chatbot.repositories.chat_history import (
    ClearHistoryCommand,
    CreateConversationCommand,
    DeleteConversationCommand,
    GetHistoryQuery,
    ListConversationsQuery,
)
from app.modules.chatbot.schemas import (
    ActionExecutionRequest,
    ActionExecutionResponse,
    AssistantConversation,
    AssistantConversationListData,
    AssistantConversationListResponse,
    AssistantConversationResponse,
    AssistantCreateConversationRequest,
    AssistantDeleteConversationResponse,
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
list_conversations_query = ListConversationsQuery()
create_conversation_command = CreateConversationCommand()
delete_conversation_command = DeleteConversationCommand()


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
async def respond(
    req: AssistantRespondRequest,
    authorization: str | None = Header(None),
):
    if not req.authToken and authorization:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        req.authToken = token

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


@assistant_router.post(
    "/respond-stream",
    dependencies=[Depends(verify_internal_key)],
)
async def respond_stream(
    req: AssistantRespondRequest,
    authorization: str | None = Header(None),
):
    if not req.authToken and authorization:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        req.authToken = token

    async def event_generator():
        try:
            async for data in respond_command.execute_stream(req):
                # Format as SSE
                yield f"data: {data.model_dump_json()}\n\n"
        except Exception as exc:
            logger.exception("Assistant stream failed")
            error_data = {
                "success": False,
                "error": _stable_client_error(502, "ASSISTANT_STREAM_FAILED", str(exc))
            }
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


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
    conversation_id: str | None = None,
):
    try:
        data = await get_history_query.execute(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
            conversation_id=conversation_id,
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


@assistant_router.get(
    "/conversations/{user_id}",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantConversationListResponse,
)
async def list_conversations_by_user(
    user_id: str,
    limit: int = Query(default=20, ge=1, le=20),
):
    try:
        raw_items = await list_conversations_query.execute(user_id, limit=limit)
        items = [
            AssistantConversation(
                id=c["id"],
                user_id=c["user_id"],
                title=c.get("title") or "Đoạn chat mới",
                created_at=c["created_at"],
                updated_at=c.get("updated_at") or c["created_at"],
                last_message_at=c.get("last_message_at"),
            )
            for c in raw_items
        ]
        return AssistantConversationListResponse(
            success=True,
            data=AssistantConversationListData(
                items=items,
                total=len(items),
                max_limit=20,
            ),
        )
    except Exception as exc:
        logger.exception("Assistant list conversations failed: userId=%s", user_id)
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(502, "ASSISTANT_CONVERSATIONS_FAILED", str(exc)),
        ) from exc


@assistant_router.post(
    "/conversations/{user_id}",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantConversationResponse,
)
async def create_conversation_by_user(
    user_id: str,
    body: AssistantCreateConversationRequest | None = None,
):
    try:
        title = body.title if body else None
        c = await create_conversation_command.execute(user_id, title=title)
        return AssistantConversationResponse(
            success=True,
            data=AssistantConversation(
                id=c["id"],
                user_id=c["user_id"],
                title=c.get("title") or "Đoạn chat mới",
                created_at=c["created_at"],
                updated_at=c.get("updated_at") or c["created_at"],
                last_message_at=c.get("last_message_at"),
            ),
        )
    except Exception as exc:
        logger.exception("Assistant create conversation failed: userId=%s", user_id)
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(502, "ASSISTANT_CREATE_CONVERSATION_FAILED", str(exc)),
        ) from exc


@assistant_router.delete(
    "/conversations/{user_id}/{conversation_id}",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantDeleteConversationResponse,
)
async def delete_conversation_by_user(
    user_id: str,
    conversation_id: str,
):
    try:
        deleted = await delete_conversation_command.execute(user_id, conversation_id)
        return AssistantDeleteConversationResponse(
            success=True,
            data={"deleted": deleted, "id": conversation_id},
        )
    except Exception as exc:
        logger.exception("Assistant delete conversation failed: userId=%s convId=%s", user_id, conversation_id)
        raise HTTPException(
            status_code=502,
            detail=_stable_client_error(502, "ASSISTANT_DELETE_CONVERSATION_FAILED", str(exc)),
        ) from exc


class InternalActionClickRequest(BaseModel):
    userId: str = Field(max_length=128)
    actionId: str = Field(max_length=128)
    destinationId: str = Field(max_length=128)


@assistant_router.post(
    "/actions/execute",
    dependencies=[Depends(verify_internal_key)],
    response_model=ActionExecutionResponse,
)
async def execute_action(
    req: ActionExecutionRequest,
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None, alias="x-user-id"),
):
    from app.modules.chatbot.actions.executor import action_executor_service

    token = None
    if authorization:
        token = authorization.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

    return await action_executor_service.execute(
        req,
        auth_token=token,
        user_id=x_user_id,
    )


@assistant_router.post(
    "/actions/click",
    dependencies=[Depends(verify_internal_key)],
)
async def record_action_click(req: InternalActionClickRequest):
    from app.modules.chatbot.navigation.telemetry import intent_telemetry

    success = await intent_telemetry.record_action_click(
        user_id=req.userId,
        action_id=req.actionId,
        destination_id=req.destinationId,
    )
    return {"success": True, "recorded": success}


@assistant_router.post(
    "/admin/rag/reindex",
    dependencies=[Depends(verify_internal_key)],
)
async def admin_reindex_rag_docs(
    background_tasks: BackgroundTasks,
    force: bool = False,
):
    from app.modules.chatbot.services.rag_indexer import rag_indexer_service

    if rag_indexer_service.is_indexing:
        return {"status": "in_progress", "message": "Reindexing is already running in background"}

    background_tasks.add_task(rag_indexer_service.trigger_reindex, force=force)
    return {"status": "accepted", "message": "Reindex triggered in background"}


@assistant_router.get(
    "/admin/telemetry/stats",
    dependencies=[Depends(verify_internal_key)],
)
async def get_telemetry_stats():
    from app.modules.chatbot.navigation.telemetry import intent_telemetry

    stats = await intent_telemetry.get_stats()
    return {"success": True, "data": stats}
