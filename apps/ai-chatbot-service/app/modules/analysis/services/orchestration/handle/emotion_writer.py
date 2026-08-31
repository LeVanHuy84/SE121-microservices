# app/services/orchestration/handle/emotion_writer.py

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from app.modules.analysis.repositories.emotion import EmotionAggregateRepository
from app.modules.analysis.schemas import (
    EmotionAggregate,
    TextEmotionResult,
    ImageEmotionResult,
)
from app.modules.analysis.enums import TargetTypeEnum
from app.modules.analysis.enums import RiskHintLevelEnum
from app.core.config import settings

logger = logging.getLogger(__name__)


class EmotionWriter:

    def __init__(self, emotion_aggregate_repo: EmotionAggregateRepository):
        self.emotion_aggregate_repo = emotion_aggregate_repo

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
            primaryEmotion=text_data.get("primaryEmotion", text_data.get("dominantEmotion")),
            secondaryEmotions=text_data.get("secondaryEmotions", []),
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
                sceneType=r.get("sceneType"),
                sceneContext=r.get("sceneContext"),
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
    ) -> dict:

        aggregate = EmotionAggregate(
            userId=user_id,
            targetId=target_id,
            targetType=target_type,  # truyền enum trực tiếp
            primaryEmotion=emotion_data.get("primaryEmotion", emotion_data.get("finalEmotion")),
            secondaryEmotions=emotion_data.get("secondaryEmotions", []),
            finalScores=emotion_data["finalScores"],
            finalConfidence=emotion_data["finalConfidence"],
            dominantModality=emotion_data["dominantModality"],
            dominantSceneType=emotion_data.get("dominantSceneType"),
            intensity=emotion_data.get("intensity"),
            textResult=self._build_text_result(emotion_data),
            imageResults=self._build_image_results(emotion_data),
            riskHintLevel=emotion_data.get(
                "riskHintLevel", RiskHintLevelEnum.NONE
            ),
            modelVersion=settings.EMOTION_MODEL_VERSION,
        )

        data = aggregate.model_dump(
            mode='python',
            exclude_none=False,
            exclude={'id'}
        )

        return await self.emotion_aggregate_repo.save(data)


    # ======================================================
    # UPDATED (FIXED SIGNATURE)
    # ======================================================
    async def save_updated(
        self,
        target_id: str,
        target_type: TargetTypeEnum,
        emotion_data: Dict,
    ) -> dict:

        existing = await self.emotion_aggregate_repo.get_by_target(
            targetId=target_id,
            targetType=target_type.value,  # nếu DB lưu string
        )

        if not existing:
            raise ValueError(
                f"EmotionAggregate not found for target {target_id}"
            )

        text_result_dto = self._build_text_result(emotion_data)
        text_result_dict = (
            text_result_dto.model_dump(mode='json')
            if text_result_dto else None
        )

        image_results_dtos = self._build_image_results(emotion_data)
        image_results_dicts = [
            img.model_dump(mode='json')
            for img in image_results_dtos
        ]

        update_data = {
            "primaryEmotion": emotion_data.get("primaryEmotion", emotion_data.get("finalEmotion")),
            "secondaryEmotions": emotion_data.get("secondaryEmotions", []),
            "finalScores": emotion_data["finalScores"],
            "finalConfidence": emotion_data["finalConfidence"],
            "dominantModality": emotion_data["dominantModality"],
            "dominantSceneType": emotion_data.get("dominantSceneType"),
            "intensity": emotion_data.get("intensity"),
            "textResult": text_result_dict,
            "imageResults": image_results_dicts,
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
