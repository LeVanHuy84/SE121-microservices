import logging
from typing import Dict

from app.modules.analysis.repositories.outbox import ModerationRepository
from app.modules.analysis.schemas import ModerationResult
from app.modules.analysis.enums import TargetTypeEnum, SeverityEnum
from app.core.config import settings

logger = logging.getLogger(__name__)


class ModerationWriter:

    def __init__(self, moderation_repo: ModerationRepository):
        self.moderation_repo = moderation_repo

    async def save_created(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        content: str,
        moderation_data: Dict
    ) -> dict:

        moderation = ModerationResult(
            userId=user_id,
            targetId=target_id,
            targetType=target_type,
            isViolation=moderation_data.get("isViolation", False),
            action=moderation_data.get("action", "ALLOW"),
            label=moderation_data.get("label", "CLEAN"),
            labelCode=int(moderation_data.get("labelCode", 0)),
            violationScore=moderation_data.get("violationScore", 0.0),
            confidence=moderation_data.get("confidence", 1.0),
            maxSeverity=moderation_data.get("maxSeverity", SeverityEnum.NONE),
            mentalHealthSupport=moderation_data.get("mentalHealthSupport", False),
            reason=moderation_data.get("reason", ""),
            flaggedCategories=moderation_data.get("flaggedCategories", []),
            allScores=moderation_data.get("allScores", {}),
            pipelineSource=moderation_data.get("pipelineSource", "TEXT_PHOBERT"),
            modelVersion=settings.MODERATION_MODEL_VERSION,
        )

        data = moderation.model_dump(mode="json", exclude_none=False, exclude={'id'})

        logger.info(f"Saving new moderation for target {target_id}")

        return await self.moderation_repo.save_moderation(data)


    async def save_updated(
        self,
        target_id: str,
        target_type: TargetTypeEnum,
        content: str,
        moderation_data: Dict
    ) -> dict:

        existing = await self.moderation_repo.get_by_target(
            target_id,
            target_type
        )

        if not existing:
            raise ValueError(
                f"Moderation not found for target {target_id}"
            )

        update_data = {
            "isViolation": moderation_data.get(
                "isViolation",
                existing.get("isViolation"),
            ),
            "action": moderation_data.get("action", existing.get("action", "ALLOW")),
            "label": moderation_data.get("label", existing.get("label", "CLEAN")),
            "labelCode": int(moderation_data.get("labelCode", existing.get("labelCode", 0))),
            "violationScore": moderation_data.get(
                "violationScore",
                existing.get("violationScore"),
            ),
            "confidence": moderation_data.get("confidence", existing.get("confidence", 1.0)),
            "maxSeverity": moderation_data.get(
                "maxSeverity",
                existing.get("maxSeverity"),
            ),
            "mentalHealthSupport": moderation_data.get("mentalHealthSupport", existing.get("mentalHealthSupport", False)),
            "reason": moderation_data.get("reason", existing.get("reason", "")),
            "flaggedCategories": moderation_data.get("flaggedCategories", existing.get("flaggedCategories", [])),
            "allScores": moderation_data.get("allScores", existing.get("allScores", {})),
            "pipelineSource": moderation_data.get("pipelineSource", existing.get("pipelineSource", "TEXT_PHOBERT")),
            "modelVersion": settings.MODERATION_MODEL_VERSION,
        }


        return await self.moderation_repo.update_moderation(
            existing["_id"],
            update_data,
        )
