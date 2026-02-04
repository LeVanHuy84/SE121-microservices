"""
Application Service: Analysis Flow Orchestration
- Orchestrates emotion analysis flow
- Orchestrates moderation flow (SEPARATE from emotion)
- Integrates Domain Services and AI Layer
- Handles SHARE targetType (moderation only, no emotion)
"""

import logging
from typing import List, Dict, Any

# Core DTOs / Services
from app.core.dto.image_input import ImageInput
from app.core.services.image_downloader import image_downloader

# Domain Services
from app.services.domain.emotion import emotion_analyzer
from app.services.domain.risk import risk_scorer
from app.services.domain.moderation import content_moderator

# AI Layer
from app.services.ai.text_emotion import text_emotion_classifier
from app.services.ai.image_emotion import analyze_multiple_images
from app.services.ai.text_moderation import moderation_aggregator
from app.services.ai.image_moderation import moderate_multiple_images

# Utils
from app.utils.exceptions import RetryableException
from app.enums.event_enum import TargetTypeEnum

logger = logging.getLogger(__name__)


class AnalysisFlowService:
    """
    Orchestration Layer
    - Coordinates AI + Domain logic
    - Enforces moderation-first rule
    - Returns CONTRACT-CORRECT DTOs
    """

    # ======================================================
    # PUBLIC API
    # ======================================================
    async def analyze_content(
        self,
        text: str,
        image_urls: List[str],
        target_type: TargetTypeEnum
    ) -> Dict[str, Any]:

        # ========================================
        # STEP 1: DOWNLOAD IMAGES
        # ========================================
        image_inputs: List[ImageInput] = []
        if image_urls:
            image_inputs = await image_downloader.download(
                urls=image_urls,
                timeout=10
            )

        # ========================================
        # STEP 2: MODERATION (ALWAYS)
        # ========================================
        moderation_result = await self._run_moderation(text, image_inputs)
        should_block = moderation_result["is_violation"]

        # ========================================
        # STEP 3: SKIP RULES
        # ========================================
        if target_type == TargetTypeEnum.SHARE:
            return {
                "moderation": moderation_result,
                "emotion": None,
                "should_block": should_block,
                "skip_reason": "share_type",
            }

        if should_block:
            logger.info("Content blocked → skip emotion analysis")
            return {
                "moderation": moderation_result,
                "emotion": None,
                "should_block": should_block,
                "skip_reason": "blocked_content",
            }

        # ========================================
        # STEP 4: EMOTION
        # ========================================
        emotion_result = await self._run_emotion_analysis(text, image_inputs)

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "should_block": should_block,
        }

    # ======================================================
    # MODERATION FLOW
    # ======================================================
    async def _run_moderation(
        self,
        text: str,
        image_inputs: List[ImageInput],
    ) -> Dict[str, Any]:

        text_moderation = moderation_aggregator.moderate(text)

        image_moderation_results = []
        if image_inputs:
            image_moderation_results = await moderate_multiple_images(image_inputs)

        final_moderation = content_moderator.decide(
            text_moderation,
            image_moderation_results,
        )

        return {
            "is_violation": final_moderation["is_violation"],
            "violation_score": final_moderation["violation_score"],
            "max_severity": final_moderation["max_severity"],
            "text_result": text_moderation,
            "image_results": image_moderation_results,
        }

    # ======================================================
    # EMOTION FLOW (✅ CONTRACT-CORRECT)
    # ======================================================
    async def _run_emotion_analysis(
        self,
        text: str,
        image_inputs: List[ImageInput],
    ) -> Dict[str, Any]:

        # ===============================
        # TEXT EMOTION
        # ===============================
        text_emotion = text_emotion_classifier.classify(text)

        text_scores = text_emotion["emotionScores"]
        text_confidence = text_emotion.get("confidence", 0.8)

        text_result = {
            "content": text,
            "dominantEmotion": text_emotion["dominantEmotion"],
            "scores": text_scores,
            "confidence": text_confidence,
            "model": text_emotion.get("model", "phobert"),
            "meta": text_emotion.get("meta"),
        }

        # ===============================
        # IMAGE EMOTION
        # ===============================
        image_results: List[Dict[str, Any]] = []
        image_scores_avg = {}
        image_confidence = 0.0
        dominant_modality = "text"

        if image_inputs:
            image_emotions = await analyze_multiple_images(image_inputs)

            retryable_errors = [
                x for x in image_emotions
                if x.get("error") and x.get("retryable")
            ]
            retry_ratio = (
                len(retryable_errors) / len(image_emotions)
                if image_emotions else 0
            )

            if retry_ratio >= 0.4:
                raise RetryableException(
                    f"Retryable image emotion ratio too high: {retry_ratio}"
                )

            for img in image_emotions:
                if img.get("error"):
                    continue

                face = img.get("faceEmotion") or {}
                scene = img.get("sceneEmotion") or {}

                image_results.append({
                    "url": img.get("url", ""),
                    "dominantEmotion": img.get("finalEmotion", "neutral"),
                    "scores": face.get("scores") or scene.get("scores", {}),
                    "confidence": img.get("finalConfidence", 0.0),
                    "model": img.get("finalSource", "clip"),
                })

            image_scores_avg = emotion_analyzer.average_image_scores(image_emotions)
            image_confidence = emotion_analyzer.get_average_image_confidence(image_emotions)

            if image_confidence > text_confidence and image_confidence > 0.3:
                dominant_modality = "image"

        # ===============================
        # FUSION & DOMAIN LOGIC
        # ===============================
        final_scores = emotion_analyzer.fuse_emotions(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            text_confidence=text_confidence,
            image_confidence=image_confidence,
        )

        final_emotion = emotion_analyzer.get_dominant_emotion(final_scores)

        intensity = emotion_analyzer.calculate_intensity(final_scores)

        risk_hint_level = risk_scorer.detect_risk_hint(
            text=text,
            emotion=final_emotion,
            intensity=intensity["level"],
        )

        final_confidence = (
            image_confidence if dominant_modality == "image"
            else text_confidence
        )

        # ===============================
        # ✅ FINAL DTO (MATCH EmotionAggregate)
        # ===============================
        return {
            "finalEmotion": final_emotion,
            "finalScores": final_scores,
            "finalConfidence": final_confidence,
            "dominantModality": dominant_modality,
            "textResult": text_result,
            "imageResults": image_results,
            "riskHintLevel": risk_hint_level,
        }

    # ======================================================
    # TEXT ONLY (UPDATED EVENT)
    # ======================================================
    async def analyze_text_only(
        self,
        text: str,
        target_type: TargetTypeEnum,
    ) -> Dict[str, Any]:

        text_moderation = moderation_aggregator.moderate(text)

        final_moderation = content_moderator.decide(
            text_moderation=text_moderation,
            image_moderation_results=[],
        )

        moderation_result = {
            "is_violation": final_moderation["is_violation"],
            "violation_score": final_moderation["violation_score"],
            "max_severity": final_moderation["max_severity"],
            "text_result": text_moderation,
            "image_results": [],
        }

        should_block = moderation_result["is_violation"]

        if target_type == TargetTypeEnum.SHARE:
            return {
                "moderation": moderation_result,
                "emotion": None,
                "should_block": should_block,
                "skip_reason": "share_type",
            }

        emotion_result = await self._run_emotion_analysis(
            text=text,
            image_inputs=[],
        )

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "should_block": should_block,
        }


# Singleton
analysis_flow_service = AnalysisFlowService()
