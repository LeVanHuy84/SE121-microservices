"""
Domain Service: User Emotion Profile Management

Handles long-term emotion baseline tracking using Exponential Moving Average (EMA).
Tracks risk indicators like negative streaks and analysis counts.

Pure business logic - no infrastructure dependencies.
"""

import logging
from typing import Dict, Optional
from datetime import datetime, timezone, date
from app.enums.emotion_enum import EmotionEnum

logger = logging.getLogger(__name__)


class UserEmotionProfileService:
    """
    Domain service for managing user emotion profiles.
    
    Responsibilities:
    - Calculate exponential moving average of emotion vectors
    - Update dominant baseline emotion
    - Track negative emotion streaks
    - Maintain analysis counts
    """

    DEFAULT_ALPHA = 0.2
    NEGATIVE_EMOTIONS = {EmotionEnum.SADNESS, EmotionEnum.ANGER, EmotionEnum.FEAR, EmotionEnum.DISGUST}

    def __init__(self, alpha: float = DEFAULT_ALPHA):
        """
        Initialize the service.
        
        Args:
            alpha: EMA smoothing factor (0 < alpha <= 1).
                  Higher alpha = more weight to recent values.
                  Default: 0.2 (recommended for 14-30 day baseline)
        """
        if not 0 < alpha <= 1:
            raise ValueError("Alpha must be between 0 and 1")
        self.alpha = alpha

    def create_initial_profile(self, user_id: str, initial_scores: Dict[str, float]) -> dict:
        """
        Create initial user emotion profile from first emotion analysis.
        
        Args:
            user_id: User identifier
            initial_scores: Initial emotion scores from first analysis
            
        Returns:
            Initial profile dictionary
        """
        normalized_scores = self._normalize_scores(initial_scores)
        dominant_emotion = self._get_dominant_emotion(normalized_scores)
        is_negative = self._is_negative_emotion(dominant_emotion)

        return {
            "userId": user_id,
            "emotionVectorEMA": normalized_scores,
            "dominantBaselineEmotion": dominant_emotion,
            "negativeStreakDays": 1 if is_negative else 0,
            "lastNegativeAt": datetime.now(timezone.utc) if is_negative else None,
            "totalAnalyses": 1,
            "updatedAt": datetime.now(timezone.utc)
        }

    def update_profile_with_new_emotion(
        self,
        current_profile: dict,
        new_scores: Dict[str, float]
    ) -> dict:
        """
        Update emotion profile using EMA algorithm.
        
        Formula: EMA_new = alpha * current + (1 - alpha) * previous
        
        Args:
            current_profile: Existing profile data
            new_scores: New emotion scores from latest analysis
            
        Returns:
            Updated profile dictionary
        """
        previous_ema = current_profile.get("emotionVectorEMA", {})
        normalized_new = self._normalize_scores(new_scores)

        updated_ema = self._calculate_ema(previous_ema, normalized_new)
        dominant_emotion = self._get_dominant_emotion(updated_ema)

        negative_streak, last_negative_at = self._update_negative_streak(
            current_profile=current_profile,
            new_emotion=self._get_dominant_emotion(normalized_new)
        )

        return {
            "emotionVectorEMA": updated_ema,
            "dominantBaselineEmotion": dominant_emotion,
            "negativeStreakDays": negative_streak,
            "lastNegativeAt": last_negative_at,
            "totalAnalyses": current_profile.get("totalAnalyses", 0) + 1,
            "updatedAt": datetime.now(timezone.utc)
        }

    def _calculate_ema(
        self,
        previous_ema: Dict[str, float],
        current_scores: Dict[str, float]
    ) -> Dict[str, float]:
        """
        Calculate exponential moving average.
        
        EMA_new = alpha * current + (1 - alpha) * previous
        """
        ema = {}
        
        for emotion in EmotionEnum:
            key = emotion.value
            prev_value = previous_ema.get(key, 0.0)
            curr_value = current_scores.get(key, 0.0)
            
            ema[key] = self.alpha * curr_value + (1 - self.alpha) * prev_value
        
        return ema

    def _update_negative_streak(
        self,
        current_profile: dict,
        new_emotion: str
    ) -> tuple[int, Optional[datetime]]:

        is_negative = self._is_negative_emotion(new_emotion)

        current_streak = current_profile.get("negativeStreakDays", 0)
        last_negative_at = current_profile.get("lastNegativeAt")

        if not is_negative:
            return 0, last_negative_at

        now = datetime.now(timezone.utc)
        today = now.date()

        if last_negative_at:
            last_day = last_negative_at.date()

            if today == last_day:
                return current_streak, last_negative_at

            if (today - last_day).days == 1:
                return current_streak + 1, now

            return 1, now

        return 1, now

    def _normalize_scores(self, scores: Dict[str, float]) -> Dict[str, float]:
        """Ensure all emotion keys are present and normalized."""
        normalized = {e.value: 0.0 for e in EmotionEnum}
        
        total = sum(scores.values()) if scores else 0
        
        if total > 0:
            for emotion in EmotionEnum:
                key = emotion.value
                if key in scores:
                    normalized[key] = float(scores[key]) / total
        
        return normalized

    def _get_dominant_emotion(self, scores: Dict[str, float]) -> str:
        """Get emotion with highest score."""
        if not scores:
            return EmotionEnum.NEUTRAL.value
        
        return max(scores.items(), key=lambda x: x[1])[0]

    def _is_negative_emotion(self, emotion: str) -> bool:
        """Check if emotion is considered negative."""
        try:
            emotion_enum = EmotionEnum(emotion)
            return emotion_enum in self.NEGATIVE_EMOTIONS
        except ValueError:
            return False

    def calculate_risk_level(self, profile: dict) -> str:
        """
        Calculate risk level based on profile metrics.
        
        Returns:
            Risk level: 'none', 'low', 'medium', 'high'
        """
        negative_streak = profile.get("negativeStreakDays", 0)
        ema_scores = profile.get("emotionVectorEMA", {})
        
        negative_score = sum(
            ema_scores.get(e.value, 0.0) 
            for e in self.NEGATIVE_EMOTIONS
        )

        if negative_streak >= 7 or negative_score >= 0.7:
            return "high"
        elif negative_streak >= 4 or negative_score >= 0.5:
            return "medium"
        elif negative_streak >= 2 or negative_score >= 0.3:
            return "low"
        else:
            return "none"
