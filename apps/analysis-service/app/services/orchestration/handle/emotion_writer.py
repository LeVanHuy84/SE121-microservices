# app/services/orchestration/handle/emotion_writer.py

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.database.analysis_repository import AnalysisRepository
from app.database.schemas.emotion_aggregate import (
    EmotionAggregate,
    TextEmotionResult,
    ImageEmotionResult,
)
from app.enums.event_enum import TargetTypeEnum
from app.enums.emotion_enum import RiskHintLevelEnum

logger = logging.getLogger(__name__)


class EmotionWriter:

    def __init__(self, analysis_repo: AnalysisRepository):
        self.analysis_repo = analysis_repo

    # ======================================================
    # BUILDERS
    # ======================================================
    def _build_text_result(
        self, emotion_data: Dict
    ) -> Optional[TextEmotionResult]:
        text_data = emotion_data.get("textResult")
        if not text_data:
            return None

        return TextEmotionResult(
            content=text_data["content"],
            dominantEmotion=text_data["dominantEmotion"],
            scores=text_data["scores"],
            confidence=text_data["confidence"],
            model=text_data["model"],
            meta=text_data.get("meta"),
        )

    def _build_image_results(
        self, emotion_data: Dict
    ) -> List[ImageEmotionResult]:
        return [
            ImageEmotionResult(
                url=r["url"],
                dominantEmotion=r["dominantEmotion"],
                scores=r["scores"],
                confidence=r["confidence"],
                model=r["model"],
            )
            for r in emotion_data.get("imageResults", [])
        ]

    # ======================================================
    # CREATED
    # ======================================================
    async def save_created(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        emotion_data: Dict,
    ) -> EmotionAggregate:
        
        aggregate = EmotionAggregate(
            userId=user_id,
            targetId=target_id,
            targetType=target_type.value,
            finalEmotion=emotion_data["finalEmotion"],
            finalScores=emotion_data["finalScores"],
            finalConfidence=emotion_data["finalConfidence"],
            dominantModality=emotion_data["dominantModality"],
            textResult=self._build_text_result(emotion_data),
            imageResults=self._build_image_results(emotion_data),
            riskHintLevel=emotion_data.get(
                "riskHintLevel", RiskHintLevelEnum.NONE
            ),
        )

        return await self.analysis_repo.save_analysis(aggregate)

    # ======================================================
    # UPDATED (FIXED SIGNATURE)
    # ======================================================
    async def save_updated(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        emotion_data: Dict,
    ) -> EmotionAggregate:

        existing = await self.analysis_repo.get_analysis_by_target(
            user_id=user_id,
            target_id=target_id,
            target_type=target_type.value,
        )

        if not existing:
            raise ValueError(
                f"EmotionAggregate not found for target {target_id}"
            )

        update_data = {
            "finalEmotion": emotion_data["finalEmotion"],
            "finalScores": emotion_data["finalScores"],
            "finalConfidence": emotion_data["finalConfidence"],
            "dominantModality": emotion_data["dominantModality"],
            "textResult": self._build_text_result(emotion_data),
            "imageResults": self._build_image_results(emotion_data),
            "riskHintLevel": emotion_data.get(
                "riskHintLevel", RiskHintLevelEnum.NONE
            ),
            "updatedAt": datetime.now(timezone.utc),
        }

        return await self.analysis_repo.update_analysis(
            str(existing.id),
            update_data,
        )
