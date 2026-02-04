import logging

from app.database.outbox_repository import OutboxRepository
from app.database.schemas.outbox import Outbox
from app.database.schemas.moderation_result import ModerationResult
from app.database.schemas.emotion_aggregate import EmotionAggregate

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_moderation(self, moderation: ModerationResult):
        outbox = Outbox(
            topic="analysis.moderation.completed",
            eventType="moderation.completed",
            payload={
                "userId": moderation.userId,
                "targetId": moderation.targetId,
                "targetType": moderation.targetType,
                "is_violation": moderation.is_violation,
                "severity": moderation.max_severity,
                "violations": moderation.violation_categories,
                "decided_by": moderation.decided_by
            }
        )
        await self.outbox_repo.save_outbox(outbox)

    async def emit_emotion(self, emotion: EmotionAggregate):
        outbox = Outbox(
            topic="analysis.emotion.completed",
            eventType="emotion.completed",
            payload={
                "userId": emotion.userId,
                "targetId": emotion.targetId,
                "targetType": emotion.targetType,
                "finalEmotion": emotion.finalEmotion,
                "finalScores": emotion.finalScores,
                "riskHintLevel": emotion.riskHintLevel,
                "dominantModality": emotion.dominantModality
            }
        )
        await self.outbox_repo.save_outbox(outbox)
