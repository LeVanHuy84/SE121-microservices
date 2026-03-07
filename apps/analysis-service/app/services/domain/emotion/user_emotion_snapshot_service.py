"""
Domain Service: User Emotion Snapshot Computation

Computes time-windowed emotion snapshots (24h, 7d, 30d) from emotion aggregates.
Calculates emotion distribution, dominant emotion, negative ratio, and risk score.

Pure business logic - no infrastructure dependencies.
"""

import logging
import math
from typing import List, Dict, Optional
from datetime import datetime, timezone
from app.enums.emotion_enum import EmotionEnum, EmotionTimeWindowEnum

logger = logging.getLogger(__name__)


class UserEmotionSnapshotService:
    """
    Domain service for computing emotion snapshots over time windows.
    
    Responsibilities:
    - Aggregate emotion data over time windows (24h, 7d, 30d)
    - Calculate emotion distribution
    - Identify dominant emotion
    - Compute negative emotion ratio
    - Calculate risk score
    """

    NEGATIVE_EMOTIONS = {EmotionEnum.SADNESS, EmotionEnum.ANGER, EmotionEnum.FEAR, EmotionEnum.DISGUST}

    def compute_snapshot(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum,
        aggregates: List[dict],
        user_profile: Optional[dict] = None
    ) -> dict:
        """
        Compute emotion snapshot from a list of emotion aggregates.
        
        REFACTORED: Now includes emotionVolatility calculation
        
        Args:
            user_id: User identifier
            window: Time window (24h, 7d, 30d)
            aggregates: List of emotion aggregate documents
            user_profile: Optional user profile for baseline comparison
            
        Returns:
            Snapshot dictionary ready for persistence
        """
        if not aggregates:
            return self._create_empty_snapshot(user_id, window)

        emotion_distribution = self._calculate_emotion_distribution(aggregates)
        dominant_emotion = self._get_dominant_emotion(emotion_distribution)
        negative_ratio = self._calculate_negative_ratio(aggregates)
        risk_score = self._calculate_risk_score(
            emotion_distribution=emotion_distribution,
            negative_ratio=negative_ratio,
            total_count=len(aggregates),
            user_profile=user_profile
        )
        emotion_volatility = self._calculate_emotion_volatility(aggregates)

        return {
            "userId": user_id,
            "window": window.value,
            "emotionDistribution": emotion_distribution,
            "dominantEmotion": dominant_emotion,
            "negativeRatio": negative_ratio,
            "riskScore": risk_score,
            "emotionVolatility": emotion_volatility,
            "computedAt": datetime.now(timezone.utc)
        }

    def _create_empty_snapshot(self, user_id: str, window: EmotionTimeWindowEnum) -> dict:
        """Create snapshot when no data is available."""
        return {
            "userId": user_id,
            "window": window.value,
            "emotionDistribution": {e.value: 0.0 for e in EmotionEnum},
            "dominantEmotion": EmotionEnum.NEUTRAL.value,
            "negativeRatio": 0.0,
            "riskScore": 0.0,
            "emotionVolatility": 0.0,
            "computedAt": datetime.now(timezone.utc)
        }

    def _calculate_emotion_distribution(self, aggregates: List[dict]) -> Dict[str, float]:
        """
        Calculate emotion distribution from aggregates.
        
        Returns count of each emotion type.
        """
        distribution = {e.value: 0.0 for e in EmotionEnum}
        
        for aggregate in aggregates:
            final_emotion = aggregate.get("finalEmotion")
            if final_emotion:
                distribution[final_emotion] = distribution.get(final_emotion, 0) + 1
        
        return distribution

    def _get_dominant_emotion(self, distribution: Dict[str, float]) -> str:
        """Get the most frequent emotion."""
        if not distribution or all(v == 0 for v in distribution.values()):
            return EmotionEnum.NEUTRAL.value
        
        return max(distribution.items(), key=lambda x: x[1])[0]

    def _calculate_negative_ratio(self, aggregates: List[dict]) -> float:
        """
        Calculate ratio of negative emotions to total emotions.
        
        Returns value between 0.0 and 1.0
        """
        if not aggregates:
            return 0.0

        negative_count = sum(
            1 for agg in aggregates
            if self._is_negative_emotion(agg.get("finalEmotion"))
        )

        return negative_count / len(aggregates)

    def _calculate_risk_score(
        self,
        emotion_distribution: Dict[str, float],
        negative_ratio: float,
        total_count: int,
        user_profile: Optional[dict] = None
    ) -> float:
        """
        Calculate risk score based on emotion patterns.
        
        IMPROVED FORMULA (Production Fix):
        Previously biased toward active users due to absolute frequency count.
        Now uses normalized ratios only.
        
        Risk factors:
        1. Negative emotion ratio (0-0.5 weight)
        2. Severe negative ratio (0-0.3 weight)  
        3. Trend vs baseline deviation (0-0.2 weight)
        
        Rationale:
        - Primary indicator: What % of emotions are negative
        - Secondary: Severity of negative emotions
        - Tertiary: Deviation from user's normal baseline
        - Removed: Absolute activity count (was biasing active users)
        
        Returns:
            Risk score between 0.0 and 1.0
        """
        if total_count == 0:
            return 0.0

        # Primary risk: negative emotion ratio (0-0.5)
        base_risk = negative_ratio * 0.5

        # Secondary risk: severe negative concentration (0-0.3)
        severe_negative_ratio = self._calculate_severe_negative_ratio(emotion_distribution, total_count)
        severe_risk = severe_negative_ratio * 0.3

        # Tertiary risk: deviation from baseline (0-0.2)
        baseline_deviation_risk = 0.0
        if user_profile:
            baseline_deviation_risk = self._calculate_baseline_deviation_risk(
                emotion_distribution=emotion_distribution,
                total_count=total_count,
                user_profile=user_profile
            ) * 0.2

        total_risk = base_risk + severe_risk + baseline_deviation_risk
        
        return min(total_risk, 1.0)

    def _calculate_baseline_deviation_risk(
        self,
        emotion_distribution: Dict[str, float],
        total_count: int,
        user_profile: dict
    ) -> float:
        """
        Calculate risk from deviation vs user's emotional baseline.
        
        If current window emotions differ significantly from long-term baseline,
        it may indicate emotional instability or stress.
        
        Returns:
            Deviation risk score 0.0 to 1.0
        """
        baseline_ema = user_profile.get("emotionVectorEMA", {})
        if not baseline_ema:
            return 0.0

        # Normalize current distribution to ratios
        current_ratios = {
            emotion: count / total_count
            for emotion, count in emotion_distribution.items()
        }

        # Calculate squared deviation for negative emotions only
        negative_deviation = 0.0
        for emotion in self.NEGATIVE_EMOTIONS:
            emotion_key = emotion.value
            current = current_ratios.get(emotion_key, 0.0)
            baseline = baseline_ema.get(emotion_key, 0.0)
            
            # Penalize increase in negative emotions, not decrease
            if current > baseline:
                negative_deviation += (current - baseline) ** 2

        # Normalize deviation (max theoretical deviation ≈ 4 for all negatives)
        deviation_risk = min(negative_deviation / 2.0, 1.0)
        
        return deviation_risk

    def _calculate_severe_negative_ratio(
        self,
        distribution: Dict[str, float],
        total_count: int
    ) -> float:
        """Calculate ratio of severe negative emotions (sadness, anger, fear)."""
        if total_count == 0:
            return 0.0

        severe_emotions = {EmotionEnum.SADNESS, EmotionEnum.ANGER, EmotionEnum.FEAR}
        severe_count = sum(
            distribution.get(e.value, 0)
            for e in severe_emotions
        )

        return severe_count / total_count

    def _is_negative_emotion(self, emotion: str) -> bool:
        """Check if emotion is considered negative."""
        if not emotion:
            return False
        
        try:
            emotion_enum = EmotionEnum(emotion)
            return emotion_enum in self.NEGATIVE_EMOTIONS
        except ValueError:
            return False

    def _calculate_emotion_volatility(self, aggregates: List[dict]) -> float:
        """
        Calculate emotion volatility (emotional instability) over time.
        
        Measures how much emotions fluctuate within the time window.
        Higher volatility indicates emotional instability.
        
        Implementation: Standard deviation of emotion vector changes.
        For each consecutive pair of aggregates, we compute the emotion vector
        and calculate how much it changed. High changes = high volatility.
        
        Returns:
            Volatility score between 0.0 and 1.0
            - 0.0 = stable emotional state
            - 1.0 = highly volatile emotional state
        """
        if len(aggregates) < 2:
            return 0.0  # Not enough data to measure volatility
        
        # Sort aggregates by timestamp (if available) or use order as-is
        sorted_aggregates = sorted(
            aggregates, 
            key=lambda x: x.get("createdAt", x.get("timestamp", 0))
        )
        
        # Calculate emotion changes between consecutive aggregates
        emotion_changes = []
        
        for i in range(len(sorted_aggregates) - 1):
            current = sorted_aggregates[i]
            next_agg = sorted_aggregates[i + 1]
            
            # Get emotion vectors
            current_emotion = current.get("finalEmotion", "neutral")
            next_emotion = next_agg.get("finalEmotion", "neutral")
            
            # If emotions changed, record a change
            # Simple approach: count emotion switches
            if current_emotion != next_emotion:
                # Calculate magnitude of change using emotion scores if available
                current_scores = current.get("finalScores", {})
                next_scores = next_agg.get("finalScores", {})
                
                if current_scores and next_scores:
                    # Calculate Euclidean distance between emotion vectors
                    change_magnitude = self._calculate_vector_distance(
                        current_scores, next_scores
                    )
                else:
                    # Fallback: simple binary change (0 or 1)
                    change_magnitude = 1.0
                
                emotion_changes.append(change_magnitude)
            else:
                emotion_changes.append(0.0)
        
        if not emotion_changes:
            return 0.0
        
        # Calculate standard deviation of changes
        import math
        mean_change = sum(emotion_changes) / len(emotion_changes)
        variance = sum((x - mean_change) ** 2 for x in emotion_changes) / len(emotion_changes)
        std_dev = math.sqrt(variance)
        
        # Normalize to 0-1 range
        # Typical std_dev for high volatility is around 0.5-0.7
        # We'll cap at 1.0 for anything above 0.7
        volatility = min(std_dev / 0.7, 1.0)
        
        return volatility

    def _calculate_vector_distance(
        self, 
        scores1: Dict[str, float], 
        scores2: Dict[str, float]
    ) -> float:
        """
        Calculate Euclidean distance between two emotion score vectors.
        
        Args:
            scores1: First emotion score dict
            scores2: Second emotion score dict
            
        Returns:
            Distance between 0.0 and ~1.414 (sqrt(2) for max change)
        """
        import math
        
        # Get all possible emotions
        all_emotions = set(scores1.keys()) | set(scores2.keys())
        
        # Calculate squared differences
        squared_diff = 0.0
        for emotion in all_emotions:
            val1 = scores1.get(emotion, 0.0)
            val2 = scores2.get(emotion, 0.0)
            squared_diff += (val1 - val2) ** 2
        
        return math.sqrt(squared_diff)

    def calculate_trend(
        self,
        current_snapshot: dict,
        previous_snapshot: dict
    ) -> dict:
        """
        Calculate trend between current and previous snapshot.
        
        Returns:
            Dictionary with trend indicators
        """
        if not previous_snapshot:
            return {
                "negativeRatioChange": 0.0,
                "riskScoreChange": 0.0,
                "dominantEmotionChanged": False
            }

        current_negative = current_snapshot.get("negativeRatio", 0.0)
        previous_negative = previous_snapshot.get("negativeRatio", 0.0)
        
        current_risk = current_snapshot.get("riskScore", 0.0)
        previous_risk = previous_snapshot.get("riskScore", 0.0)
        
        current_dominant = current_snapshot.get("dominantEmotion")
        previous_dominant = previous_snapshot.get("dominantEmotion")

        return {
            "negativeRatioChange": current_negative - previous_negative,
            "riskScoreChange": current_risk - previous_risk,
            "dominantEmotionChanged": current_dominant != previous_dominant
        }
