import logging

from app.modules.analysis.repositories.outbox import OutboxRepository
from app.modules.analysis.schemas import Outbox
from app.modules.analysis.enums import EventTypeEnum, ResultEventEnum
from app.modules.analysis.utils.moderation_mapper import build_violations, build_display_message

logger = logging.getLogger(__name__)


class OutboxEmitter:

    def __init__(self, outbox_repo: OutboxRepository):
        self.outbox_repo = outbox_repo

    async def emit_analysis_result(self, action: EventTypeEnum, moderation: dict, emotion: dict = None):
        """Emit unified analysis result event containing both moderation and emotion payload"""
        target_id = moderation.get("targetId") or (emotion.get("targetId") if emotion else "")
        print(f'[OutboxEmitter] Emitting unified analysis_result event for targetId={target_id}, action={action.value}')

        is_violation = moderation.get("isViolation", False)
        mod_action = moderation.get("action", "ALLOW")
        label = moderation.get("label", "CLEAN")
        mental_health_support = moderation.get("mentalHealthSupport", False)
        confidence_val = moderation.get("confidence", moderation.get("violationScore", 1.0))

        violations = build_violations(moderation)
        display_message = build_display_message(
            is_violation,
            violations,
            action=mod_action,
            mental_health_support=mental_health_support,
            label=label,
        )

        moderation_payload = {
            "targetId": moderation["targetId"],
            "targetType": moderation["targetType"],
            "userId": moderation.get("userId"),
            "action": mod_action,
            "label": label,
            "isViolation": is_violation,
            "mentalHealthSupport": mental_health_support,
            "violations": violations,
            "confidence": confidence_val,
            "displayMessage": display_message,
            "createdAt": moderation.get("createdAt").isoformat() if hasattr(moderation.get("createdAt"), "isoformat") else str(moderation.get("createdAt", "")),
        }

        payload = {
            "userId": moderation.get("userId") or (emotion.get("userId") if emotion else ""),
            "targetId": target_id,
            "targetType": moderation.get("targetType") or (emotion.get("targetType") if emotion else ""),
            "content": moderation.get("content") or (emotion.get("content", "") if emotion else ""),
            "moderation": moderation_payload,
        }

        if emotion:
            risk_level = emotion.get("mentalHealthRiskLevel", "none")
            payload.update({
                "modelVersion": emotion.get("modelVersion"),
                "primaryEmotion": (emotion.get("primaryEmotion") or emotion.get("finalEmotion", "")).upper(),
                "secondaryEmotions": [e.upper() for e in emotion.get("secondaryEmotions", [])],
                "scores": emotion.get("finalScores", {}),
                "confidence": emotion.get("finalConfidence", 1.0),
                "isSarcasmOrConflict": emotion.get("isSarcasmOrConflict", False),
                "mentalHealthRiskLevel": risk_level,
                "createdAt": emotion.get("createdAt").isoformat() if emotion.get("createdAt") else None,
            })
        else:
            # Khi emotion là None (vi phạm bị chặn hoặc skip): tính toán riskLevel dựa trên moderation
            if label == "SELF_HARM":
                fallback_risk = "critical"
            elif label == "EMOTIONAL_CRISIS" or mental_health_support:
                fallback_risk = "high"
            else:
                fallback_risk = "none"

            payload.update({
                "modelVersion": moderation.get("modelVersion", "1.0.0"),
                "scores": {},
                "confidence": confidence_val,
                "mentalHealthRiskLevel": fallback_risk,
            })

        outbox = Outbox(
            topic=ResultEventEnum.ANALYSIS_RESULT.value,
            eventType=action.value,
            payload=payload,
        )

        data = outbox.model_dump(mode="json", exclude_none=False, exclude={"id"})
        await self.outbox_repo.save_outbox(data)
