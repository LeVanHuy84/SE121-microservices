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
from app.modules.analysis.enums import TargetTypeEnum

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
        flagged_cats = vlm_mod.get("flagged_categories", [])
        
        # Determine VLM action & label based on VLM moderation response
        if should_block:
            if "SELF_HARM" in flagged_cats:
                action = "ALLOW_WITH_SUPPORT"
                should_block = False  # Do not block self-harm/emotional crisis posts
                label = "EMOTIONAL_CRISIS"
                label_code = 3
                max_severity = "none"
                mental_health_support = True
            elif any(cat in flagged_cats for cat in ["NSFW_ADULT"]):
                action = "HARD_BLOCK"
                label = "ILLEGAL_PORN"
                label_code = 4
                max_severity = "high"
                mental_health_support = False
            else:
                action = "HARD_BLOCK"
                label = "HATE_SPEECH"
                label_code = 2
                max_severity = "high"
                mental_health_support = False
        else:
            action = "ALLOW"
            label = "CLEAN"
            label_code = 0
            max_severity = "none"
            mental_health_support = False

        confidence = float(vlm_mod.get("confidence", 0.95)) if should_block else float(vlm_mod.get("confidence", 1.0))

        moderation_result = {
            "isViolation": should_block,
            "action": action,
            "label": label,
            "labelCode": label_code,
            "confidence": confidence,
            "mentalHealthSupport": mental_health_support,
            "reason": vlm_mod.get("reason", ""),
            "flaggedCategories": flagged_cats,
            "pipelineSource": "VLM_UNIFIED",
            "allScores": {label: confidence}
        }


        if target_type == TargetTypeEnum.SHARE or should_block:
            logger.info(f"Multimodal content processed → shouldBlock: {should_block}, action: {action}")
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
        raw_intensity = vlm_res.get("intensity", "moderate")
        intensity_dict = raw_intensity if isinstance(raw_intensity, dict) else {"level": str(raw_intensity), "score": confidence}

        emotion_result = {
            "primaryEmotion": primary_emotion,
            "secondaryEmotions": secondary_emotions,
            "finalConfidence": confidence,
            "finalScores": final_scores,
            "intensity": intensity_dict,
            "pipelineSource": "MULTIMODAL_VLM",
            "isSarcasmOrConflict": vlm_res.get("isSarcasmOrConflict", False),
            "conflictExplanation": vlm_res.get("conflictExplanation", ""),
            "mentalHealthRiskLevel": vlm_res.get("mentalHealthRiskLevel", "none"),
            "suggestedAction": vlm_res.get("suggestedAction", "NO_ACTION"),
            "content": text,
            "imageUrls": [img.url if hasattr(img, "url") else str(img) for img in image_inputs]
        }

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "shouldBlock": should_block,
        }

    async def analyze_batch_multimodal_vlm(
        self,
        batch_items: List[Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        """
        Analyze multiple multimodal posts in a SINGLE VLM API request.
        batch_items: [{"id": "post_1", "text": "...", "images": [...], "target_type": TargetTypeEnum}, ...]
        Returns dict keyed by post_id -> analysis result format matching analyze_content.
        """
        if not batch_items:
            return {}

        logger.info(f"[AnalysisFlow] Batch processing {len(batch_items)} Multimodal posts via VLM...")
        
        vlm_posts = []
        for item in batch_items:
            vlm_posts.append({
                "id": item["id"],
                "text": item["text"],
                "images": item.get("image_inputs") or item.get("images", [])
            })

        try:
            batch_vlm_res = vlm_analyzer.analyze_batch_posts(vlm_posts)
        except Exception as e:
            logger.error(f"[AnalysisFlow] Batch VLM execution error: {e}. Falling back to item-by-item processing.")
            results = {}
            for item in batch_items:
                results[item["id"]] = await self._analyze_multimodal_vlm(
                    text=item["text"],
                    image_inputs=item.get("image_inputs") or item.get("images", []),
                    target_type=item.get("target_type", TargetTypeEnum.POST)
                )
            return results

        final_batch_results = {}
        for item in batch_items:
            p_id = item["id"]
            text = item["text"]
            image_inputs = item.get("image_inputs") or item.get("images", [])
            target_type = item.get("target_type", TargetTypeEnum.POST)
            vlm_res = batch_vlm_res.get(p_id)

            if not vlm_res:
                final_batch_results[p_id] = await self._analyze_text_only(text, target_type, is_fallback=True)
                continue

            vlm_mod = vlm_res.get("contentModeration", {})
            should_block = bool(vlm_mod.get("is_flagged", False))
            flagged_cats = vlm_mod.get("flagged_categories", [])

            if should_block:
                if "SELF_HARM" in flagged_cats:
                    action = "ALLOW_WITH_SUPPORT"
                    should_block = False
                    label = "EMOTIONAL_CRISIS"
                    label_code = 3
                    max_severity = "none"
                    mental_health_support = True
                elif any(cat in flagged_cats for cat in ["NSFW_ADULT"]):
                    action = "HARD_BLOCK"
                    label = "ILLEGAL_PORN"
                    label_code = 4
                    max_severity = "high"
                    mental_health_support = False
                else:
                    action = "HARD_BLOCK"
                    label = "HATE_SPEECH"
                    label_code = 2
                    max_severity = "high"
                    mental_health_support = False
            else:
                action = "ALLOW"
                label = "CLEAN"
                label_code = 0
                max_severity = "none"
                mental_health_support = False

            confidence = float(vlm_mod.get("confidence", 0.95)) if should_block else float(vlm_mod.get("confidence", 1.0))

            moderation_result = {
                "isViolation": should_block,
                "action": action,
                "label": label,
                "labelCode": label_code,
                "confidence": confidence,
                "mentalHealthSupport": mental_health_support,
                "reason": vlm_mod.get("reason", ""),
                "flaggedCategories": flagged_cats,
                "pipelineSource": "VLM_UNIFIED_BATCH",
                "allScores": {label: confidence}
            }


            if target_type == TargetTypeEnum.SHARE or should_block:
                final_batch_results[p_id] = {
                    "moderation": moderation_result,
                    "emotion": None,
                    "shouldBlock": should_block,
                    "skipReason": "share_type" if target_type == TargetTypeEnum.SHARE else "blocked_content",
                }
                continue


            primary_emotion = vlm_res.get("primaryEmotion", "neutral")
            secondary_emotions = vlm_res.get("secondaryEmotions", [])
            final_scores = vlm_res.get("emotionScores", {})
            confidence = float(vlm_res.get("finalConfidence", 0.8))
            raw_intensity = vlm_res.get("intensity", "moderate")
            intensity_dict = raw_intensity if isinstance(raw_intensity, dict) else {"level": str(raw_intensity), "score": confidence}

            emotion_result = {
                "primaryEmotion": primary_emotion,
                "secondaryEmotions": secondary_emotions,
                "finalConfidence": confidence,
                "finalScores": final_scores,
                "intensity": intensity_dict,
                "pipelineSource": "MULTIMODAL_VLM",
                "isSarcasmOrConflict": vlm_res.get("isSarcasmOrConflict", False),
                "conflictExplanation": vlm_res.get("conflictExplanation", ""),
                "mentalHealthRiskLevel": vlm_res.get("mentalHealthRiskLevel", "none"),
                "suggestedAction": vlm_res.get("suggestedAction", "NO_ACTION"),
                "content": text,
                "imageUrls": [img.url if hasattr(img, "url") else str(img) for img in image_inputs]
            }

            final_batch_results[p_id] = {
                "moderation": moderation_result,
                "emotion": emotion_result,
                "shouldBlock": should_block,
            }

        return final_batch_results

    # ======================================================
    # TEXT-ONLY FLOW (PHOBERT)
    # ======================================================
    async def _analyze_text_only(
        self,
        text: str,
        target_type: TargetTypeEnum,
        is_fallback: bool = False
    ) -> Dict[str, Any]:
        source_tag = "PHOBERT_TEXT_FALLBACK" if is_fallback else "PHOBERT_TEXT_ONLY"
        logger.info(f"[AnalysisFlow] Routing to Text-only PhoBERT Pipeline ({source_tag})...")

        # Moderation First
        text_moderation = moderation_aggregator.moderate(text)
        should_block = bool(text_moderation.get("isViolation", False))
        action = text_moderation.get("action", "ALLOW")

        moderation_result = {
            "isViolation": should_block,
            "action": action,
            "label": text_moderation.get("label", "CLEAN"),
            "labelCode": text_moderation.get("labelCode", 0),
            "confidence": float(text_moderation.get("confidence", 1.0)),
            "mentalHealthSupport": bool(text_moderation.get("mentalHealthSupport", False)),
            "reason": text_moderation.get("reason", ""),
            "flaggedCategories": text_moderation.get("flaggedCategories", []),
            "pipelineSource": source_tag,
            "allScores": text_moderation.get("allScores", {})
        }


        if target_type == TargetTypeEnum.SHARE or should_block:
            logger.info(f"Text-only content processed → shouldBlock: {should_block}, action: {action}")
            return {
                "moderation": moderation_result,
                "emotion": None,
                "shouldBlock": should_block,
                "skipReason": "share_type" if target_type == TargetTypeEnum.SHARE else "blocked_content",
            }

        # Emotion Analysis (Always runs for CLEAN, PROFANITY_VENTING, and EMOTIONAL_CRISIS)
        text_emotion = text_emotion_classifier.classify(text)
        text_scores = text_emotion.get("emotionScores", {})
        text_confidence = float(text_emotion.get("confidence", 0.8))
        intensity_obj = emotion_analyzer.calculate_intensity(text_scores)


        # Enhance risk hint level if emotional crisis label detected
        risk_hint = "high" if action == "ALLOW_WITH_SUPPORT" else "none"

        emotion_result = {
            "primaryEmotion": text_emotion.get("primaryEmotion"),
            "secondaryEmotions": text_emotion.get("secondaryEmotions", []),
            "finalConfidence": text_confidence,
            "finalScores": text_scores,
            "intensity": intensity_obj,
            "pipelineSource": "TEXT_PHOBERT",
            "isSarcasmOrConflict": False,
            "conflictExplanation": "",
            "mentalHealthRiskLevel": risk_hint,
            "suggestedAction": "SUGGEST_AI_CHATBOT" if action == "ALLOW_WITH_SUPPORT" else "NO_ACTION",
            "content": text,
            "imageUrls": []
        }

        return {
            "moderation": moderation_result,
            "emotion": emotion_result,
            "shouldBlock": should_block,
        }



# Singleton Instance
analysis_flow_service = AnalysisFlowService()
