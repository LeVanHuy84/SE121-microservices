"""
EmotionContextService — fetches the user's latest emotion snapshot from MongoDB.

Design:
- Uses the singleton `emotion_aggregate_repo` (initialized in analysis/lifespan.py).
- Implements a 500ms asyncio timeout and fallbacks to a neutral snapshot to prevent blocking the chat flow.
- Uses lazy imports for the analysis module to avoid circular dependencies.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field

logger = logging.getLogger("uvicorn.error")

_NEGATIVE_EMOTIONS = frozenset({"sadness", "fear", "anger", "disgust"})
_HIGH_RISK_LEVELS = frozenset({"medium", "high"})
_CHECKIN_ACTIONS = frozenset({"TRIGGER_PROACTIVE_CHECKIN", "PLAYLIST_AND_TIPS", "MEDICAL_DOCUMENT", "CRISIS_HOTLINE", "CHATBOT_COMPANION"})


@dataclass
class EmotionSnapshot:
    primary_emotion: str = "neutral"    # sadness | joy | fear | anger | neutral | ...
    risk_level: str = "none"            # none | weak | medium | high
    suggested_action: str = "NO_ACTION" # NO_ACTION | MONITOR | TRIGGER_PROACTIVE_CHECKIN
    chatbot_prompt_context: str | None = None

    @property
    def needs_empathetic_tone(self) -> bool:
        """Requires an empathetic tone when the user is experiencing high-risk negative emotions."""
        return (
            self.primary_emotion in _NEGATIVE_EMOTIONS
            and self.risk_level in _HIGH_RISK_LEVELS
        )

    @property
    def needs_proactive_checkin(self) -> bool:
        """The system should proactively check in on the user."""
        return self.suggested_action in _CHECKIN_ACTIONS or bool(self.chatbot_prompt_context)


_DEFAULT_SNAPSHOT = EmotionSnapshot()


class EmotionContextService:
    """Fetches the latest EmotionSnapshot for the user from MongoDB's emotion_aggregates."""

    _TIMEOUT_SECONDS: float = 0.5  # 500ms — prevents blocking the chat flow
    _CACHE_TTL_SECONDS: float = 300.0  # 5 minutes cache to prevent excessive DB calls

    def __init__(self) -> None:
        self._redis = None
        self._redis_disabled_until = 0.0

    def _get_redis(self):
        if self._redis is False:
            if time.time() < self._redis_disabled_until:
                return None
            self._redis = None

        if self._redis is not None:
            return self._redis

        try:
            from redis.asyncio import Redis
            from app.core.config import settings

            self._redis = Redis.from_url(
                settings.CHATBOT_REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=settings.CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS,
                socket_timeout=settings.CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS,
            )
            return self._redis
        except Exception as exc:
            self._disable_redis(exc)
            return None

    def _disable_redis(self, exc: Exception):
        from app.core.config import settings
        logger.warning("[EmotionCtx] Disabling Redis temporarily due to error: %s", exc)
        self._redis = False
        self._redis_disabled_until = time.time() + settings.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS

    async def update_cache(self, user_id: str, snapshot: EmotionSnapshot):
        redis = self._get_redis()
        if not redis:
            return
        
        key = f"chatbot:emotion:{user_id}"
        data = {
            "primary_emotion": snapshot.primary_emotion,
            "risk_level": snapshot.risk_level,
            "suggested_action": snapshot.suggested_action,
        }
        if snapshot.chatbot_prompt_context:
            data["chatbot_prompt_context"] = snapshot.chatbot_prompt_context
            
        try:
            await redis.setex(key, int(self._CACHE_TTL_SECONDS), json.dumps(data))
        except Exception as exc:
            self._disable_redis(exc)

    async def get_snapshot(self, user_id: str | None) -> EmotionSnapshot:
        """
        Returns the latest EmotionSnapshot. Falls back to a neutral snapshot if:
        - user_id is empty
        - MongoDB times out or fails
        - The user has no analyzed posts
        """
        if not user_id:
            return _DEFAULT_SNAPSHOT

        redis = self._get_redis()
        if redis:
            key = f"chatbot:emotion:{user_id}"
            try:
                cached = await redis.get(key)
                if cached:
                    data = json.loads(cached)
                    return EmotionSnapshot(
                        primary_emotion=data.get("primary_emotion", "neutral"),
                        risk_level=data.get("risk_level", "none"),
                        suggested_action=data.get("suggested_action", "NO_ACTION"),
                        chatbot_prompt_context=data.get("chatbot_prompt_context"),
                    )
            except Exception as exc:
                self._disable_redis(exc)

        try:
            async with asyncio.timeout(self._TIMEOUT_SECONDS):
                snapshot = await self._fetch(user_id)
                await self.update_cache(user_id, snapshot)
                return snapshot
        except TimeoutError:
            logger.warning(
                "[EmotionCtx] Timeout fetching emotion snapshot for userId=%s", user_id
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[EmotionCtx] Failed to fetch emotion snapshot for userId=%s: %s",
                user_id,
                exc,
            )
        return _DEFAULT_SNAPSHOT

    async def _fetch(self, user_id: str) -> EmotionSnapshot:
        # Lazy import to avoid circular dependency since the analysis module might not be fully initialized
        from app.modules.analysis.lifespan import emotion_aggregate_repo  # noqa: PLC0415

        docs = await emotion_aggregate_repo.get_user_recent_analyses(user_id, limit=1)
        if not docs:
            return _DEFAULT_SNAPSHOT

        doc = docs[0]
        # The Emotion aggregate stores either primaryEmotion or finalEmotion (due to 2 different pipelines)
        primary = (
            doc.get("primaryEmotion")
            or doc.get("finalEmotion")
            or "neutral"
        ).lower()
        risk = (doc.get("mentalHealthRiskLevel") or "none").lower()
        action = doc.get("suggestedAction") or "NO_ACTION"

        return EmotionSnapshot(
            primary_emotion=primary,
            risk_level=risk,
            suggested_action=action,
        )


emotion_context_service = EmotionContextService()
