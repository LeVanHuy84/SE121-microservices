import logging

from app.database.outbox_repository import OutboxRepository
from app.database.schemas.outbox import Outbox
from app.database.schemas.moderation_result import ModerationResult
from app.database.schemas.emotion_aggregate import EmotionAggregate
from app.enums.event_enum import ResultEventEnum

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_moderation(self, moderation: ModerationResult):
        outbox = Outbox(
            topic="analysis",
            eventType=ResultEventEnum.MODERATION_REJECTION.value,
            payload={
                "targetId": moderation.targetId,
                "targetType": moderation.targetType,
            }
        )
        await self.outbox_repo.save_outbox(outbox)

    async def emit_emotion(self, emotion: EmotionAggregate):
        outbox = Outbox(
            topic="analysis.emotion.completed",
            eventType=ResultEventEnum.EMOTION_RESULT.value,
            payload={
                "targetId": emotion.targetId,
                "targetType": emotion.targetType,
                "finalEmotion": emotion.finalEmotion,
                "finalScores": emotion.finalScores,
                "riskHintLevel": emotion.riskHintLevel,
            }
        )
        await self.outbox_repo.save_outbox(outbox)
