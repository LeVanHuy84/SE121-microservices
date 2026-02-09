import logging

from app.database.outbox_repository import OutboxRepository
from app.database.schemas.outbox import Outbox
from app.enums.event_enum import ResultEventEnum

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_moderation(self, moderation: dict):
        """Emit moderation rejection event"""
        # Build Pydantic DTO
        outbox = Outbox(
            topic="analysis",
            eventType=ResultEventEnum.MODERATION_REJECTION.value,
            payload={
                "targetId": moderation["targetId"],
                "targetType": moderation["targetType"],
            }
        )
        
        # Convert to dict for persistence
        data = outbox.model_dump(mode='json', exclude_none=False, exclude={'id'})
        await self.outbox_repo.save_outbox(data)

    async def emit_emotion(self, emotion: dict):
        """Emit emotion analysis result event"""
        # Build Pydantic DTO
        outbox = Outbox(
            topic="analysis.emotion.completed",
            eventType=ResultEventEnum.EMOTION_RESULT.value,
            payload={
                "targetId": emotion["targetId"],
                "targetType": emotion["targetType"],
                "finalEmotion": emotion["finalEmotion"],
                "finalScores": emotion["finalScores"],
                "riskHintLevel": emotion.get("riskHintLevel"),
            }
        )
        
        # Convert to dict for persistence
        data = outbox.model_dump(mode='json', exclude_none=False, exclude={'id'})
        await self.outbox_repo.save_outbox(data)
