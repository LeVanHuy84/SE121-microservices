import logging

from app.modules.analysis.repositories.outbox import OutboxRepository
from app.modules.analysis.schemas import Outbox
from app.modules.analysis.enums import EventTypeEnum, ResultEventEnum
from app.modules.analysis.utils.moderation_mapper import build_violations, build_display_message

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_moderation(self, moderation: dict):
        is_violation = moderation.get("isViolation", False)
        action = moderation.get("action", "ALLOW")

        violations = build_violations(moderation)

        display_message = build_display_message(is_violation, violations, action=action)

        outbox = Outbox(
            topic=ResultEventEnum.MODERATION_REJECTED.value,
            eventType="MODERATION_EVALUATED",
            payload={
                "targetId": moderation["targetId"],
                "targetType": moderation["targetType"],
                "userId": moderation.get("userId"),
                "action": action,
                "label": moderation.get("label", "CLEAN"),
                "isViolation": is_violation,
                "mentalHealthSupport": moderation.get("mentalHealthSupport", False),

                "violations": violations,

                "maxSeverity": str(moderation.get("maxSeverity", "")).upper(),
                "confidence": moderation.get("confidence", moderation.get("violationScore")),

                "displayMessage": display_message,

                "createdAt": moderation.get("createdAt").isoformat() if hasattr(moderation.get("createdAt"), "isoformat") else str(moderation.get("createdAt", "")),
            }
        )

        data = outbox.model_dump(
            mode="json",
            exclude_none=True,
            exclude={"id"}
        )

        await self.outbox_repo.save_outbox(data)

    async def emit_emotion(self, action: EventTypeEnum, emotion: dict):
        """Emit emotion analysis result event"""
        print(f'[OutboxEmitter] Emitting emotion event for targetId={emotion["targetId"]}, action={action.value}')
        # Build Pydantic DTO
        outbox = Outbox(
            topic=ResultEventEnum.EMOTION_RESULT.value,
            eventType=action.value,
            payload={
                "userId": emotion["userId"],
                "targetId": emotion["targetId"],
                "targetType": emotion["targetType"],
                "modelVersion": emotion.get("modelVersion"),

                "primaryEmotion": (emotion.get("primaryEmotion") or emotion.get("finalEmotion", "")).upper(),
                "secondaryEmotions": [e.upper() for e in emotion.get("secondaryEmotions", [])],
                "scores": emotion.get("finalScores", {}),
                "confidence": emotion.get("finalConfidence", 1.0),

                "isSarcasmOrConflict": emotion.get("isSarcasmOrConflict", False),
                "mentalHealthRiskLevel": emotion.get("mentalHealthRiskLevel", "none"),

                "createdAt": emotion.get("createdAt").isoformat() if emotion.get("createdAt") else None,
            }
        )
        
        # Convert to dict for persistence
        data = outbox.model_dump(mode='json', exclude_none=False, exclude={'id'})
        await self.outbox_repo.save_outbox(data)
