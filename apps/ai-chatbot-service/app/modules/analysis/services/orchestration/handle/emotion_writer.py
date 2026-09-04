import logging
from datetime import datetime, timezone
from typing import Dict

from app.modules.analysis.repositories.emotion import EmotionAggregateRepository
from app.modules.analysis.schemas import EmotionAggregate
from app.modules.analysis.enums import TargetTypeEnum, RiskHintLevelEnum
from app.core.config import settings

logger = logging.getLogger(__name__)


class EmotionWriter:

    def __init__(self, emotion_aggregate_repo: EmotionAggregateRepository):
        self.emotion_aggregate_repo = emotion_aggregate_repo

    # ======================================================
    # CREATED
    # ======================================================
    async def save_created(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        emotion_data: Dict,
    ) -> dict:

        raw_intensity = emotion_data.get("intensity")
        intensity_obj = raw_intensity if isinstance(raw_intensity, dict) else {"level": str(raw_intensity or "moderate"), "score": emotion_data.get("finalConfidence", 0.5)}

        aggregate = EmotionAggregate(
            userId=user_id,
            targetId=target_id,
            targetType=target_type,
            modelVersion=settings.EMOTION_MODEL_VERSION,
            pipelineSource=emotion_data.get("pipelineSource", "TEXT_PHOBERT"),
            primaryEmotion=emotion_data.get("primaryEmotion", emotion_data.get("finalEmotion")),
            secondaryEmotions=emotion_data.get("secondaryEmotions", []),
            finalScores=emotion_data["finalScores"],
            finalConfidence=emotion_data["finalConfidence"],
            intensity=intensity_obj,
            isSarcasmOrConflict=emotion_data.get("isSarcasmOrConflict", False),
            conflictExplanation=emotion_data.get("conflictExplanation", ""),
            mentalHealthRiskLevel=emotion_data.get("mentalHealthRiskLevel", "none"),
            suggestedAction=emotion_data.get("suggestedAction", "NO_ACTION"),
            content=emotion_data.get("content", ""),
            imageUrls=emotion_data.get("imageUrls", []),
            riskHintLevel=emotion_data.get(
                "riskHintLevel", RiskHintLevelEnum.NONE
            ),
        )

        data = aggregate.model_dump(
            mode='python',
            exclude_none=False,
            exclude={'id'}
        )

        return await self.emotion_aggregate_repo.save(data)

    # ======================================================
    # UPDATED
    # ======================================================
    async def save_updated(
        self,
        target_id: str,
        target_type: TargetTypeEnum,
        emotion_data: Dict,
    ) -> dict:

        existing = await self.emotion_aggregate_repo.get_by_target(
            targetId=target_id,
            targetType=target_type.value,
        )

        if not existing:
            raise ValueError(
                f"EmotionAggregate not found for target {target_id}"
            )

        raw_intensity = emotion_data.get("intensity")
        intensity_obj = raw_intensity if isinstance(raw_intensity, dict) else {"level": str(raw_intensity or "moderate"), "score": emotion_data.get("finalConfidence", 0.5)}

        update_data = {
            "primaryEmotion": emotion_data.get("primaryEmotion", emotion_data.get("finalEmotion")),
            "secondaryEmotions": emotion_data.get("secondaryEmotions", []),
            "finalScores": emotion_data["finalScores"],
            "finalConfidence": emotion_data["finalConfidence"],
            "pipelineSource": emotion_data.get("pipelineSource", "TEXT_PHOBERT"),
            "intensity": intensity_obj,
            "isSarcasmOrConflict": emotion_data.get("isSarcasmOrConflict", False),
            "conflictExplanation": emotion_data.get("conflictExplanation", ""),
            "mentalHealthRiskLevel": emotion_data.get("mentalHealthRiskLevel", "none"),
            "suggestedAction": emotion_data.get("suggestedAction", "NO_ACTION"),
            "content": emotion_data.get("content", ""),
            "imageUrls": emotion_data.get("imageUrls", []),
            "riskHintLevel": emotion_data.get(
                "riskHintLevel", RiskHintLevelEnum.NONE
            ),
            "updatedAt": datetime.now(timezone.utc),
            "modelVersion": settings.EMOTION_MODEL_VERSION,
        }

        return await self.emotion_aggregate_repo.update(
            existing["_id"],
            update_data,
        )
