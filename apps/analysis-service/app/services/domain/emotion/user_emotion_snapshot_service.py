"""Domain service for 7d/30d snapshot computation in daily batch mode."""

from datetime import datetime, timezone
import math

from app.enums.emotion_enum import EmotionEnum, EmotionTimeWindowEnum


class UserEmotionSnapshotService:
    NEGATIVE_FOR_RATIO = {
        EmotionEnum.SADNESS.value,
        EmotionEnum.ANGER.value,
        EmotionEnum.FEAR.value,
    }
    POLARITY_WEIGHTS = {
        EmotionEnum.JOY.value: 1.0,
        EmotionEnum.SURPRISE.value: 0.5,
        EmotionEnum.NEUTRAL.value: 0.0,
        EmotionEnum.SADNESS.value: -1.0,
        EmotionEnum.ANGER.value: -1.0,
        EmotionEnum.FEAR.value: -1.0,
        EmotionEnum.DISGUST.value: -1.0,
    }

    def compute_snapshot(
        self,
        user_id: str,
        window: EmotionTimeWindowEnum,
        aggregates: list[dict],
        computed_at: datetime | None = None,
    ) -> dict:
        if computed_at is None:
            computed_at = datetime.now(timezone.utc)

        counts = {emotion.value: 0.0 for emotion in EmotionEnum}
        total = 0
        polarity_series: list[float] = []

        for aggregate in aggregates:
            emotion = aggregate.get("finalEmotion")
            if emotion in counts:
                counts[emotion] += 1.0
                total += 1

            polarity_series.append(self._aggregate_polarity(aggregate))

        if total == 0:
            distribution = counts
            negative_ratio = 0.0
            emotion_volatility = 0.0
        else:
            distribution = {key: value / total for key, value in counts.items()}
            negative_ratio = sum(distribution.get(key, 0.0) for key in self.NEGATIVE_FOR_RATIO)
            emotion_volatility = self._calculate_stddev(polarity_series)

        negative_ratio = self._clamp01(negative_ratio)
        emotion_volatility = self._clamp01(emotion_volatility)
        risk_score = self._clamp01((0.7 * negative_ratio) + (0.3 * emotion_volatility))

        return {
            "userId": user_id,
            "window": window.value,
            "emotionDistribution": distribution,
            "negativeRatio": negative_ratio,
            "emotionVolatility": emotion_volatility,
            "riskScore": risk_score,
            "createdAt": computed_at,
        }

    def _clamp01(self, value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    def _aggregate_polarity(self, aggregate: dict) -> float:
        scores = aggregate.get("finalScores")
        if isinstance(scores, dict) and scores:
            weighted = 0.0
            total_weight = 0.0
            for emotion, raw_score in scores.items():
                weight = self.POLARITY_WEIGHTS.get(emotion)
                if weight is None:
                    continue
                try:
                    score = float(raw_score)
                except (TypeError, ValueError):
                    continue
                weighted += score * weight
                total_weight += abs(score)
            if total_weight > 0:
                return weighted / total_weight

        final_emotion = aggregate.get("finalEmotion")
        return float(self.POLARITY_WEIGHTS.get(final_emotion, 0.0))

    def _calculate_stddev(self, values: list[float]) -> float:
        if not values:
            return 0.0
        mean = sum(values) / len(values)
        variance = sum((value - mean) ** 2 for value in values) / len(values)
        return math.sqrt(variance)
