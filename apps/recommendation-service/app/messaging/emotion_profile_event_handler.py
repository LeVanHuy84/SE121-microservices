from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.query_cache import query_cache

logger = logging.getLogger(__name__)


class EmotionProfileEventHandler:
    SUPPORTED_EVENT_TYPES = {
        "recommendation.emotion.profile-updated",
    }

    def __init__(self, repository: RecommendationStateRepository):
        self.repository = repository

    async def handle(self, message: dict[str, Any]):
        event_type = str(message.get("type") or "").strip()
        payload = message.get("payload") or {}
        if event_type not in self.SUPPORTED_EVENT_TYPES:
            logger.warning("Skipping unsupported recommendation emotion event=%s", event_type)
            return

        user_id = str(payload.get("userId") or "").strip()
        if not user_id:
            logger.warning("Skipping emotion event with missing userId payload=%s", payload)
            return

        risk_score = self._safe_number(payload.get("riskScore"))
        negativity_score = self._safe_number(payload.get("recentNegativityScore"))
        dominant_emotion = (
            str(payload.get("dominantEmotion") or "").strip() or None
        )
        emotion_scores = payload.get("finalScores")
        if not isinstance(emotion_scores, dict):
            emotion_scores = {}

        occurred_at = self._parse_occurred_at(payload.get("occurredAt"))
        self.repository.upsert_emotion_profile(
            user_id=user_id,
            risk_score=risk_score,
            recent_negativity_score=negativity_score,
            dominant_emotion=dominant_emotion,
            emotion_scores=emotion_scores,
            source_event_at=occurred_at,
        )
        query_cache.invalidate_viewer(user_id)
        logger.info(
            (
                "Applied recommendation emotion event: type=%s userId=%s "
                "riskScore=%.3f recentNegativityScore=%.3f"
            ),
            event_type,
            user_id,
            risk_score,
            negativity_score,
        )

    def _safe_number(self, value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.0

    def _parse_occurred_at(self, occurred_at: Any) -> datetime:
        if not isinstance(occurred_at, str) or not occurred_at.strip():
            return datetime.now(timezone.utc)

        normalized_value = occurred_at.strip().replace("Z", "+00:00")
        try:
            parsed_value = datetime.fromisoformat(normalized_value)
            if parsed_value.tzinfo is None:
                return parsed_value.replace(tzinfo=timezone.utc)
            return parsed_value
        except ValueError:
            return datetime.now(timezone.utc)
