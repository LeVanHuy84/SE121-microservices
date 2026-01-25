# app/services/domain/emotion/emotion_analyzer.py

"""
Domain Service: Emotion Analysis
- Thuần logic phân tích cảm xúc
- Không phụ thuộc DB, Kafka, Redis
- Dễ unit test
"""

import logging
from typing import Dict, Any, List, Optional
from app.enums.emotion_enum import EmotionEnum

logger = logging.getLogger(__name__)


class EmotionAnalyzer:
    """
    Domain service for emotion analysis logic.
    Pure business logic without infrastructure dependencies.
    """

    def fuse_emotions(
        self,
        text_scores: dict,
        image_scores: dict,
        text_confidence: float,
        image_confidence: float,
        min_img_conf: float = 0.25,
    ) -> dict:
        """
        Fusion text and image emotion scores.
        
        Args:
            text_scores: Emotion scores from text analysis
            image_scores: Emotion scores from image analysis
            text_confidence: Confidence of text analysis
            image_confidence: Confidence of image analysis
            min_img_conf: Minimum image confidence threshold
            
        Returns:
            Fused emotion scores
        """
        if not image_scores:
            return text_scores

        try:
            img_conf = image_confidence
            txt_conf = text_confidence
        except Exception:
            return text_scores

        # CLIP có confidence thấp → rely more on text
        if img_conf < min_img_conf:
            return text_scores

        # Dynamic weighting based on confidence
        total_conf = txt_conf + img_conf + 1e-6
        w_text = txt_conf / total_conf
        w_img = img_conf / total_conf

        fused = {
            e: w_text * text_scores.get(e, 0.0) + w_img * image_scores.get(e, 0.0)
            for e in text_scores.keys()
        }

        return fused

    def calculate_intensity(
        self, 
        emotion_scores: dict, 
        complex_result: Optional[dict] = None
    ) -> dict:
        """
        Calculate emotion intensity level.
        
        Args:
            emotion_scores: Emotion scores
            complex_result: Optional complex analysis result
            
        Returns:
            {
                "level": "mild|moderate|severe",
                "score": 0.0-1.0
            }
        """
        max_score = max(emotion_scores.values())
        
        # If complex analysis detected severe case
        if complex_result and complex_result.get("intensity") == "severe":
            return {
                "level": "severe",
                "score": max_score
            }
        
        # Threshold-based intensity
        if max_score >= 0.75:
            level = "severe"
        elif max_score >= 0.5:
            level = "moderate"
        else:
            level = "mild"
        
        return {
            "level": level,
            "score": round(max_score, 3)
        }

    def average_image_scores(self, image_results: List[dict]) -> dict:
        """
        Average emotion scores from multiple images.
        
        Args:
            image_results: List of image analysis results
            
        Returns:
            Averaged emotion scores
        """
        try:
            base = {e.value: 0.0 for e in EmotionEnum}
            count = 0

            for item in image_results or []:
                scores = item.get("emotionScores")
                if not scores:
                    continue

                for e in EmotionEnum:
                    base[e.value] += scores.get(e.value, 0.0)
                count += 1

            if count == 0:
                return base

            return {e.value: base[e.value] / count for e in EmotionEnum}

        except Exception as e:
            logger.error(f"Error averaging image scores: {e}")
            return {e.value: 0.0 for e in EmotionEnum}

    def get_average_image_confidence(self, image_results: List[dict]) -> float:
        """
        Get average confidence from image results.
        
        Args:
            image_results: List of image analysis results
            
        Returns:
            Average confidence score
        """
        confidences = [
            item.get("confidence", 0.0) 
            for item in image_results 
            if not item.get("error")
        ]
        
        if not confidences:
            return 0.0
        
        return sum(confidences) / len(confidences)

    def get_dominant_emotion(self, emotion_scores: dict) -> str:
        """
        Get dominant emotion from scores.
        
        Args:
            emotion_scores: Emotion scores dictionary
            
        Returns:
            Dominant emotion key
        """
        return max(emotion_scores, key=emotion_scores.get)

    def get_dominant_scene_type(self, image_results: List[dict]) -> str:
        """
        Get dominant scene type from image analysis results.
        
        Args:
            image_results: List of image analysis results
            
        Returns:
            Dominant scene type
        """
        scene_types = [
            img.get("sceneType", "") 
            for img in image_results 
            if not img.get("error")
        ]
        
        if not scene_types:
            return ""
        
        return max(set(scene_types), key=scene_types.count)

    def convert_single_emotion_to_scores(self, emotion: str) -> dict:
        """
        Convert single emotion string to score dict.
        
        Args:
            emotion: Emotion string
            
        Returns:
            Emotion scores dictionary with 1.0 for the given emotion
        """
        scores = {e.value: 0.0 for e in EmotionEnum}
        if emotion in scores:
            scores[emotion] = 1.0
        else:
            scores[EmotionEnum.NEUTRAL.value] = 1.0
        return scores


# Singleton instance
emotion_analyzer = EmotionAnalyzer()
