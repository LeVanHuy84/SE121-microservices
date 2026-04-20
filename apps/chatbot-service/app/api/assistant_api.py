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
        data = await assistant_service.respond(req)
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
