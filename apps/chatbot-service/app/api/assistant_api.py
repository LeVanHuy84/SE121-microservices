import logging

from fastapi import APIRouter, Depends, HTTPException

from app.bootstrap import assistant_service
from app.core.security import verify_internal_key
from app.schemas.assistant_schema import (
    AssistantRespondRequest,
    AssistantRespondResponse,
)

assistant_router = APIRouter(prefix="/assistant")
logger = logging.getLogger("uvicorn.error")


@assistant_router.post(
    "/respond",
    dependencies=[Depends(verify_internal_key)],
    response_model=AssistantRespondResponse,
)
async def respond(req: AssistantRespondRequest):
    try:
        data = await assistant_service.respond(req)
        return AssistantRespondResponse(success=True, data=data)
    except Exception as exc:
        logger.exception(
            "Assistant response failed: userId=%s conversationId=%s",
            req.userId,
            req.conversationId,
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc
