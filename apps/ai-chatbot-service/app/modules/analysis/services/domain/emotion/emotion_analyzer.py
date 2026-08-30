# app/services/domain/emotion/emotion_analyzer.py
"""
Domain Service: Emotion Analysis
- Thuần logic phân tích cảm xúc
- Không phụ thuộc DB, Kafka, Redis
- Dễ unit test
- Chuẩn hoá schema theo EmotionEnum
"""

import logging
from typing import List, Optional, Dict
from app.modules.analysis.enums import EmotionEnum, IntensityLevelEnum

logger = logging.getLogger(__name__)


class EmotionAnalyzer:
    """
    Domain service for emotion analysis logic.
    Pure business logic without infrastructure dependencies.
    """

    def _empty_scores(self) -> Dict[str, float]:
        return {e.value: 0.0 for e in EmotionEnum}

    def normalize_scores(self, scores: Optional[dict]) -> Dict[str, float]:
        """
        Ensure scores always contain all EmotionEnum keys.
        Missing keys will be filled with 0.0
        """
        base = self._empty_scores()
        if not scores:
            return base

        for e in EmotionEnum:
            if e.value in scores:
                try:
                    base[e.value] = float(scores.get(e.value, 0.0))
                except Exception:
                    base[e.value] = 0.0
        return base

    def fuse_emotions(
        self,
        text_scores: dict,
        image_scores: dict,
        text_confidence: float,
        image_confidence: float,
        min_img_conf: float = 0.25,
    ) -> dict:
        """
        Fusion text and image emotion scores using confidence-based weighting.
        Always returns normalized schema following EmotionEnum.
        """
        txt_scores = self.normalize_scores(text_scores)
        img_scores = self.normalize_scores(image_scores)

        # Nếu không có image hoặc image confidence thấp → dùng text
        if not image_scores or image_confidence < min_img_conf:
            return txt_scores

        try:
            txt_conf = float(text_confidence or 0.0)
            img_conf = float(image_confidence or 0.0)
        except Exception:
            return txt_scores

        total_conf = txt_conf + img_conf + 1e-6
        w_text = txt_conf / total_conf
        w_img = img_conf / total_conf

        fused = {
            e.value: w_text * txt_scores.get(e.value, 0.0) + w_img * img_scores.get(e.value, 0.0)
            for e in EmotionEnum
        }

        return fused

    def calculate_intensity(
        self,
        emotion_scores: dict,
    ) -> dict:
        """
        Calculate emotion intensity level based on max score.

        Returns:
            {
                "level": "mild|moderate|severe",
                "score": 0.0-1.0
            }
        """
        scores = self.normalize_scores(emotion_scores)
        max_score = max(scores.values()) if scores else 0.0

        if max_score >= 0.75:
            level = IntensityLevelEnum.SEVERE.value
        elif max_score >= 0.5:
            level = IntensityLevelEnum.MODERATE.value
        else:
            level = IntensityLevelEnum.MILD.value

        return {
            "level": level,
            "score": round(float(max_score), 3)
        }

    def average_image_scores(self, image_results: List[dict]) -> dict:
        """
        Average emotion scores from multiple images.
        Expects each item has: { "scores": {emotion: value, ...} }
        """
        try:
            base = self._empty_scores()
            count = 0

            for item in image_results or []:
                scores = item.get("scores")
                if not scores:
                    continue

                norm = self.normalize_scores(scores)
                for e in EmotionEnum:
                    base[e.value] += norm.get(e.value, 0.0)
                count += 1

            if count == 0:
                return base

            return {e.value: base[e.value] / count for e in EmotionEnum}

        except Exception as e:
            logger.error(f"Error averaging image scores: {e}")
            return self._empty_scores()

    def get_average_image_confidence(self, image_results: List[dict]) -> float:
        """
        Get average confidence from image results.
        Expects each item has: { "confidence": float }
        """
        confidences = [
            float(item.get("confidence", 0.0))
            for item in image_results or []
            if not item.get("error")
        ]

        if not confidences:
            return 0.0

        return sum(confidences) / len(confidences)

    def get_dominant_emotion(self, emotion_scores: dict) -> str:
        """
        Get dominant emotion from scores.
        Always safe with normalized schema.
        """
        scores = self.normalize_scores(emotion_scores)
        return max(scores, key=scores.get)

    def extract_primary_and_secondary_emotions(self, emotion_scores: dict) -> dict:
        """
        Extract primaryEmotion (nhãn chính) và secondaryEmotions (danh sách nhãn phụ).
        - primaryEmotion: nhãn có xác suất cao nhất.
        - secondaryEmotions: các nhãn phụ có prob >= max(0.10, primary_prob * 0.45).
        """
        scores = self.normalize_scores(emotion_scores)
        sorted_items = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        primary_emotion, primary_prob = sorted_items[0]
        dynamic_threshold = max(0.10, primary_prob * 0.45)

        secondary_emotions = [
            emotion
            for emotion, prob in sorted_items[1:]
            if prob >= dynamic_threshold
        ]

        return {
            "primaryEmotion": primary_emotion,
            "secondaryEmotions": secondary_emotions,
        }

    def get_dominant_scene_type(self, image_results: List[dict]) -> str:
        """
        Get dominant scene type from image analysis results.
        """
        scene_types = [
            img.get("sceneType", "")
            for img in image_results or []
            if not img.get("error") and img.get("sceneType")
        ]

        if not scene_types:
            return ""

        return max(set(scene_types), key=scene_types.count)

    def convert_single_emotion_to_scores(self, emotion: str) -> dict:
        """
        Convert single emotion string to score dict.
        Useful as fallback when model returns only label.
        """
        scores = self._empty_scores()
        if emotion in scores:
            scores[emotion] = 1.0
        else:
            scores[EmotionEnum.NEUTRAL.value] = 1.0
        return scores


# Singleton instance
emotion_analyzer = EmotionAnalyzer()
