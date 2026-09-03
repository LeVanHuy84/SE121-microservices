# app/modules/analysis/services/orchestration/analysis_flow_service.py
"""
Application Service: Analysis Flow Orchestration
- Text-only: Uses PhoBERT Text Moderation & PhoBERT 7 Ekman Emotion Classifier
- Multimodal (Text + Image): Uses Unified VLM Analyzer (Groq API Vision Pipeline)
- Output normalized DTO for Feed re-rank & Emotion Intelligence usage
"""

import logging
from typing import List, Dict, Any

# Core DTOs / Services
from app.modules.analysis.schemas import ImageInput
from app.modules.analysis.services.image_downloader import image_downloader

# Domain Services
from app.modules.analysis.services.domain.emotion import emotion_analyzer

# AI Layer
from app.modules.analysis.services.ml_models.text_emotion import text_emotion_classifier
from app.modules.analysis.services.ml_models.text_moderation import moderation_aggregator
from app.modules.analysis.services.ml_models.vlm import vlm_analyzer

# Utils
from app.modules.analysis.enums import TargetTypeEnum, DominantModalityEnum

logger = logging.getLogger(__name__)


class AnalysisFlowService:
    """
    Orchestration Layer
    - Coordinates AI + Domain logic
    - Enforces moderation-first rule
    - Routes Text-only to PhoBERT and Multimodal (Text+Image) to Unified VLM
    """

    def __init__(self, moderation_repo=None, emotion_aggregate_repo=None):
        self.moderation_repo = moderation_repo
        self.emotion_aggregate_repo = emotion_aggregate_repo

    # ======================================================
    # PUBLIC API
    # ======================================================
    async def analyze_content(
        self,
        text: str,
        image_urls: List[str],
        target_type: TargetTypeEnum
    ) -> Dict[str, Any]:

        # Download images if provided
        image_inputs: List[ImageInput] = []
        if image_urls:
            try:
                image_inputs = await image_downloader.download(
                    urls=image_urls,
                    timeout=10
                )
            except Exception as e:
                logger.warning(f"Image download warning: {e}")

        # Routing: Multimodal (VLM) vs Text-only (PhoBERT)
        if image_inputs or image_urls:
            return await self._analyze_multimodal_vlm(text, image_inputs or image_urls, target_type)
        else:
            return await self._analyze_text_only(text, target_type, is_fallback=False)

    # ======================================================
    # MULTIMODAL VLM FLOW (TEXT + IMAGE)
    # ======================================================
    async def _analyze_multimodal_vlm(
        self,
        text: str,
        image_inputs: List[Any],
        target_type: TargetTypeEnum
    ) -> Dict[str, Any]:
        logger.info(f"[AnalysisFlow] Routing to Unified VLM Pipeline for Multimodal content ({len(image_inputs)} images)...")
        
        try:
            vlm_res = vlm_analyzer.analyze_post(text, image_inputs)
        except Exception as e:
            logger.error(f"[AnalysisFlow] VLM execution error: {e}. Fallback to text moderation.")
            return await self._analyze_text_only(text, target_type, is_fallback=True)

        vlm_mod = vlm_res.get("contentModeration", {})
        should_block = bool(vlm_mod.get("is_flagged", False))

        moderation_result = {
            "isViolation": should_block,
            "violationScore": float(vlm_mod.get("confidence", 0.95)) if should_block else 0.0,
            "maxSeverity": "high" if should_block else "none",
            "textResult": {"isViolation": should_block, "reason": vlm_mod.get("reason", "")},
            "imageResults": [vlm_mod],
            "reason": vlm_mod.get("reason", ""),
            "flaggedCategories": vlm_mod.get("flagged_categories", []),
            "pipelineSource": "VLM_UNIFIED"
        }

        if target_type == TargetTypeEnum.SHARE or should_block:
            logger.info(f"Multimodal content processed → shouldBlock: {should_block}")
            return {
                "moderation": moderation_result,
                "emotion": None,
                "shouldBlock": should_block,
                "skipReason": "share_type" if target_type == TargetTypeEnum.SHARE else "blocked_content",
            }

        # Emotion DTO
        primary_emotion = vlm_res.get("primaryEmotion", "neutral")
        secondary_emotions = vlm_res.get("secondaryEmotions", [])
        final_scores = vlm_res.get("emotionScores", {})
        confidence = float(vlm_res.get("finalConfidence", 0.8))

        emotion_result = {
            "primaryEmotion": primary_emotion,
            "secondaryEmotions": secondary_emotions,
            "finalConfidence": confidence,
            "finalScores": final_scores,
            "intensity": vlm_res.get("intensity", "moderate"),
            "dominantModality": DominantModalityEnum.IMAGE.value,
            "isSarcasmOrConflict": vlm_res.get("isSarcasmOrConflict", False),
            "conflictExplanation": vlm_res.get("conflictExplanation", ""),
            "textResult": {
                "content": text,
                "primaryEmotion": primary_emotion,
                "secondaryEmotions": secondary_emotions,
                "scores": final_scores,
                "confidence": confidence,
                "model": vlm_res.get("modelUsed", "vlm_groq")
            },
            "imageResults": [{
                "url": img.url if hasattr(img, "url") else str(img),
                "dominantEmotion": primary_emotion,
                "scores": final_scores,
                "confidence": confidence,
                "model": vlm_res.get("modelUsed", "vlm_groq")
            } for img in image_inputs]
        }

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "shouldBlock": should_block,
        }

    # ======================================================
    # TEXT-ONLY FLOW (PHOBERT)
    # ======================================================
    async def _analyze_text_only(
        self,
        text: str,
        target_type: TargetTypeEnum,
        is_fallback: bool = False
    ) -> Dict[str, Any]:
        source_tag = "PHOBERT_TEXT_FALLBACK" if is_fallback else "PHOBERT_TEXT"
        logger.info(f"[AnalysisFlow] Routing to Text-only PhoBERT Pipeline ({source_tag})...")

        # 1. Moderation
        text_moderation = moderation_aggregator.moderate(text)
        should_block = bool(text_moderation.get("isViolation", False))

        moderation_result = {
            "isViolation": should_block,
            "violationScore": text_moderation.get("violationScore", 0.0),
            "maxSeverity": text_moderation.get("maxSeverity", "none"),
            "textResult": text_moderation,
            "imageResults": [],
            "reason": text_moderation.get("reason", "Phân tích nội dung chữ qua PhoBERT"),
            "flaggedCategories": ["TOXIC_LANGUAGE"] if should_block else [],
            "pipelineSource": source_tag
        }

        if target_type == TargetTypeEnum.SHARE or should_block:
            return {
                "moderation": moderation_result,
                "emotion": None,
                "shouldBlock": should_block,
                "skipReason": "share_type" if target_type == TargetTypeEnum.SHARE else "blocked_content",
            }

        # 2. Emotion Classification
        text_emotion = text_emotion_classifier.classify(text)

        text_scores_raw = text_emotion.get("emotionScores") or {}
        text_scores = emotion_analyzer.normalize_scores(text_scores_raw)
        text_confidence = float(text_emotion.get("confidence", 0.8))

        text_result = {
            "content": text,
            "dominantEmotion": text_emotion.get("dominantEmotion"),
            "primaryEmotion": text_emotion.get("primaryEmotion"),
            "secondaryEmotions": text_emotion.get("secondaryEmotions", []),
            "scores": text_scores,
            "confidence": text_confidence,
            "model": text_emotion.get("model", "phobert"),
            "meta": text_emotion.get("meta"),
        }

        emotion_result = {
            "primaryEmotion": text_emotion.get("primaryEmotion"),
            "secondaryEmotions": text_emotion.get("secondaryEmotions", []),
            "finalConfidence": text_confidence,
            "finalScores": text_scores,
            "intensity": "moderate",
            "dominantModality": DominantModalityEnum.TEXT.value,
            "isSarcasmOrConflict": False,
            "conflictExplanation": "",
            "textResult": text_result,
            "imageResults": [],
        }

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "shouldBlock": should_block,
        }


# Singleton Instance
analysis_flow_service = AnalysisFlowService()
