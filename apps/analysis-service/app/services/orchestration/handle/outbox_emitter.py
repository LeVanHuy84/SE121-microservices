import logging

from app.database.outbox_repository import OutboxRepository
from app.database.schemas.outbox import Outbox
from app.enums.event_enum import EventTypeEnum, ResultEventEnum

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_moderation(self, moderation: dict):
        """Emit moderation rejection event"""
        # Build Pydantic DTO
        outbox = Outbox(
            topic=ResultEventEnum.MODERATION_REJECTED.value,
            eventType="",
            payload={
                "targetId": moderation["targetId"],
                "targetType": moderation["targetType"],
            }
        )
        
        # Convert to dict for persistence
        data = outbox.model_dump(mode='json', exclude_none=False, exclude={'id'})
        await self.outbox_repo.save_outbox(data)

    async def emit_emotion(self, action: EventTypeEnum, emotion: dict):
        """Emit emotion analysis result event"""
        print(f'[OutboxEmitter] Emitting emotion event for targetId={emotion["targetId"]}, action={action.value}')
        # Build Pydantic DTO
        outbox = Outbox(
            topic=ResultEventEnum.EMOTION_RESULT.value,
            eventType=action.value,
            payload={
                "targetId": emotion["targetId"],
                "targetType": emotion["targetType"],
                "finalEmotion": emotion["finalEmotion"].upper(),
                "scores": emotion["finalScores"],
                "confidence": emotion["finalConfidence"],
                "intensityScore": emotion["intensity"]["score"],
                "dominantModality": emotion["dominantModality"],
                "dominantSceneType": emotion.get("dominantSceneType"),
                "riskHintLevel": emotion.get("riskHintLevel"),
            }
        )
        
        # Convert to dict for persistence
        data = outbox.model_dump(mode='json', exclude_none=False, exclude={'id'})
        await self.outbox_repo.save_outbox(data)
