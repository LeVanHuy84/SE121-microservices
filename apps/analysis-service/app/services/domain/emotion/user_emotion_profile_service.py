"""Domain service for daily user emotion profile EMA updates."""

from typing import Dict

from app.enums.emotion_enum import EmotionEnum


class UserEmotionProfileService:
    DEFAULT_ALPHA = 0.2

    def __init__(self, alpha: float = DEFAULT_ALPHA):
        if not 0 < alpha <= 1:
            raise ValueError("Alpha must be between 0 and 1")
        self.alpha = alpha

    def compute_distribution_from_aggregates(self, aggregates: list[dict]) -> Dict[str, float]:
        counts = {emotion.value: 0.0 for emotion in EmotionEnum}
        total = 0

        for aggregate in aggregates:
            emotion = aggregate.get("finalEmotion")
            if emotion in counts:
                counts[emotion] += 1.0
                total += 1

        if total == 0:
            return counts

        return {key: value / total for key, value in counts.items()}

    def apply_ema(
        self,
        previous_ema: Dict[str, float],
        current_distribution: Dict[str, float],
    ) -> Dict[str, float]:
        updated = {}
        for emotion in EmotionEnum:
            key = emotion.value
            previous = float(previous_ema.get(key, 0.0))
            current = float(current_distribution.get(key, 0.0))
            updated[key] = self.alpha * current + (1 - self.alpha) * previous
        return updated
