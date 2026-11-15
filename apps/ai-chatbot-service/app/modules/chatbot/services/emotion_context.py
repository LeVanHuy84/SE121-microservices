"""
EmotionContextService — fetches longitudinal and acute emotion state for a user.

Design:
- Single-writer Redis Hash contract:
  - `chatbot:emotion:acute:{user_id}` (written by `emotion_event_consumer.py`)
  - `emotion:longitudinal:{user_id}` (written by `emotion-intelligence-service`)
- Reads both Hashes in a single Redis PIPELINE (`HGETALL` + `HGETALL`) with a 500ms timeout.
- Relies on `emotion-intelligence-service` writing `emotion:longitudinal:{user_id}` directly
  (no cross-database MongoDB reads); local `emotion_aggregates` is used only as acute fallback.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger("uvicorn.error")

_NEGATIVE_EMOTIONS = frozenset({"sadness", "fear", "anger", "disgust"})
_HIGH_RISK_LEVELS = frozenset({"medium", "high"})
_HYSTERESIS_HIGH_LEVELS = frozenset({"MODERATE_RISK", "HIGH_RISK", "CRISIS"})
_CHECKIN_ACTIONS = frozenset(
    {
        "TRIGGER_PROACTIVE_CHECKIN",
        "PLAYLIST_AND_TIPS",
        "MEDICAL_DOCUMENT",
        "CRISIS_HOTLINE",
        "CHATBOT_COMPANION",
    }
)


def _derive_legacy_risk_level(hysteresis_risk_level: str, acute_risk_level: str) -> str:
    upper = (hysteresis_risk_level or "NORMAL").upper()
    if upper in {"CRISIS", "HIGH_RISK"}:
        return "high"
    if upper == "MODERATE_RISK":
        return "medium"
    if upper == "MILD_STRESS":
        return "weak"
    return (acute_risk_level or "none").lower()


@dataclass
class EmotionSnapshot:
    primary_emotion: str = "neutral"  # sadness | joy | fear | anger | neutral | ...
    risk_level: str = "none"  # none | weak | medium | high
    suggested_action: str = (
        "NO_ACTION"  # NO_ACTION | PLAYLIST_AND_TIPS | MEDICAL_DOCUMENT | CRISIS_HOTLINE
    )
    chatbot_prompt_context: str | None = None
    persistent_distress: bool = False
    recent_trend: str = "stable"  # stable | deteriorating | recovering
    hysteresis_risk_level: str = (
        "NORMAL"  # NORMAL | MILD_STRESS | MODERATE_RISK | HIGH_RISK | CRISIS
    )
    acute_emotion: str = "neutral"
    acute_risk_level: str = "none"
    consecutive_negative_days: int = 0

    @property
    def needs_empathetic_tone(self) -> bool:
        """Requires an empathetic tone when the user is experiencing high-risk negative emotions."""
        return self.hysteresis_risk_level in _HYSTERESIS_HIGH_LEVELS or (
            self.primary_emotion in _NEGATIVE_EMOTIONS
            and self.risk_level in _HIGH_RISK_LEVELS
        )

    @property
    def needs_proactive_checkin(self) -> bool:
        """The system should proactively check in on the user."""
        return self.suggested_action in _CHECKIN_ACTIONS or bool(
            self.chatbot_prompt_context
        )


_DEFAULT_SNAPSHOT = EmotionSnapshot()


class EmotionContextService:
    """Fetches and caches split acute & longitudinal EmotionSnapshot for a user."""

    _TIMEOUT_SECONDS: float = 0.5  # 500ms — prevents blocking the chat flow
    _HASH_TTL_SECONDS: int = 86400  # 24h TTL for split Redis Hashes

    def __init__(self, repo=None) -> None:
        self._redis = None
        self._loop = None
        self._redis_disabled_until = 0.0
        self._repo = repo

    def _get_current_loop(self):
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            return None

    def _get_redis(self):
        current_loop = self._get_current_loop()
        if self._redis is not None and self._redis is not False:
            if self._loop is not current_loop or (
                self._loop and self._loop.is_closed()
            ):
                self._redis = None
                self._loop = None

        if self._redis is False:
            if time.time() < self._redis_disabled_until:
                return None
            self._redis = None

        if self._redis is not None:
            return self._redis

        try:
            from redis.asyncio import Redis
            from app.core.settings import settings

            self._redis = Redis.from_url(
                settings.CHATBOT_REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=settings.CHATBOT_REDIS_CONNECT_TIMEOUT_SECONDS,
                socket_timeout=settings.CHATBOT_REDIS_SOCKET_TIMEOUT_SECONDS,
            )
            self._loop = current_loop
            return self._redis
        except Exception as exc:
            self._disable_redis(exc)
            return None

    def _disable_redis(self, exc: Exception):
        from app.core.settings import settings

        logger.warning("[EmotionCtx] Disabling Redis temporarily due to error: %s", exc)
        self._redis = False
        self._redis_disabled_until = (
            time.time() + settings.CHATBOT_REDIS_RECONNECT_BACKOFF_SECONDS
        )

    async def _hset_with_ttl(
        self, redis, key: str, mapping: dict[str, str], ttl_seconds: int
    ) -> None:
        try:
            pipe = redis.pipeline()
            pipe.hset(key, mapping=mapping)
            pipe.expire(key, ttl_seconds)
            await pipe.execute()
        except Exception as exc:
            if "WRONGTYPE" in str(exc).upper():
                await redis.delete(key)
                pipe = redis.pipeline()
                pipe.hset(key, mapping=mapping)
                pipe.expire(key, ttl_seconds)
                await pipe.execute()
            else:
                raise

    async def update_acute_cache(
        self,
        user_id: str,
        acute_emotion: str,
        acute_risk_level: str,
    ) -> None:
        redis = self._get_redis()
        if not redis or not user_id:
            return

        key = f"chatbot:emotion:acute:{user_id}"
        mapping = {
            "acute_emotion": (acute_emotion or "neutral").lower(),
            "acute_risk_level": (acute_risk_level or "none").lower(),
            "acute_updated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self._hset_with_ttl(redis, key, mapping, self._HASH_TTL_SECONDS)
        except Exception as exc:
            self._disable_redis(exc)

    async def update_longitudinal_cache(
        self,
        user_id: str,
        *,
        hysteresis_risk_level: str = "NORMAL",
        risk_score: float = 0.0,
        stable_windows: int = 0,
        consecutive_negative_days: int = 0,
        persistent_distress: bool = False,
        suggested_action: str = "NO_ACTION",
        chatbot_prompt_context: str | None = None,
        longitudinal_updated_at: str | None = None,
    ) -> None:
        redis = self._get_redis()
        if not redis or not user_id:
            return

        key = f"emotion:longitudinal:{user_id}"
        mapping = {
            "hysteresis_risk_level": str(hysteresis_risk_level or "NORMAL").upper(),
            "risk_score": str(risk_score),
            "stable_windows": str(stable_windows),
            "consecutive_negative_days": str(consecutive_negative_days),
            "persistent_distress": "true" if persistent_distress else "false",
            "suggested_action": str(suggested_action or "NO_ACTION"),
            "chatbot_prompt_context": chatbot_prompt_context or "",
            "longitudinal_updated_at": longitudinal_updated_at
            or datetime.now(timezone.utc).isoformat(),
        }
        try:
            await self._hset_with_ttl(redis, key, mapping, self._HASH_TTL_SECONDS)
        except Exception as exc:
            self._disable_redis(exc)

    async def update_cache(self, user_id: str, snapshot: EmotionSnapshot) -> None:
        """Backward-compatible helper writing longitudinal fields without touching acute hash."""
        await self.update_longitudinal_cache(
            user_id,
            hysteresis_risk_level=snapshot.hysteresis_risk_level,
            consecutive_negative_days=snapshot.consecutive_negative_days,
            persistent_distress=snapshot.persistent_distress,
            suggested_action=snapshot.suggested_action,
            chatbot_prompt_context=snapshot.chatbot_prompt_context,
        )

    async def delete_cache(self, user_id: str) -> None:
        redis = self._get_redis()
        if not redis:
            return
        try:
            await redis.delete(
                f"chatbot:emotion:{user_id}",
                f"chatbot:emotion:acute:{user_id}",
                f"emotion:longitudinal:{user_id}",
            )
        except Exception as exc:
            self._disable_redis(exc)

    def _build_snapshot_from_hashes(
        self,
        acute_hash: dict[str, str] | None,
        long_hash: dict[str, str] | None,
    ) -> EmotionSnapshot:
        acute = acute_hash or {}
        long = long_hash or {}

        acute_emotion = str(acute.get("acute_emotion") or "neutral").lower()
        acute_risk_level = str(acute.get("acute_risk_level") or "none").lower()
        hysteresis_risk_level = str(
            long.get("hysteresis_risk_level") or "NORMAL"
        ).upper()
        consecutive_negative_days = int(long.get("consecutive_negative_days") or 0)
        persistent_distress = (
            str(long.get("persistent_distress") or "false").lower() == "true"
            or hysteresis_risk_level in _HYSTERESIS_HIGH_LEVELS
            or consecutive_negative_days >= 3
        )
        suggested_action = str(long.get("suggested_action") or "NO_ACTION")
        chatbot_prompt_context = long.get("chatbot_prompt_context") or None
        risk_level = _derive_legacy_risk_level(hysteresis_risk_level, acute_risk_level)

        return EmotionSnapshot(
            primary_emotion=acute_emotion,
            risk_level=risk_level,
            suggested_action=suggested_action,
            chatbot_prompt_context=chatbot_prompt_context,
            persistent_distress=persistent_distress,
            recent_trend="stable",
            hysteresis_risk_level=hysteresis_risk_level,
            acute_emotion=acute_emotion,
            acute_risk_level=acute_risk_level,
            consecutive_negative_days=consecutive_negative_days,
        )

    async def get_snapshot(self, user_id: str | None) -> EmotionSnapshot:
        """
        Returns the latest EmotionSnapshot. Falls back to a neutral snapshot if:
        - user_id is empty
        - Redis/MongoDB times out or fails
        """
        if not user_id:
            return _DEFAULT_SNAPSHOT

        acute_hash: dict[str, str] = {}
        redis = self._get_redis()
        if redis:
            acute_key = f"chatbot:emotion:acute:{user_id}"
            long_key = f"emotion:longitudinal:{user_id}"
            try:
                async with asyncio.timeout(self._TIMEOUT_SECONDS):
                    pipe = redis.pipeline()
                    pipe.hgetall(acute_key)
                    pipe.hgetall(long_key)
                    results = await pipe.execute()
                acute_hash = dict(results[0] or {})
                long_hash = dict(results[1] or {})
                if long_hash:
                    return self._build_snapshot_from_hashes(acute_hash, long_hash)
            except Exception as exc:
                if "WRONGTYPE" in str(exc).upper():
                    try:
                        await redis.delete(acute_key, long_key)
                    except Exception:
                        pass
                else:
                    self._disable_redis(exc)

        try:
            async with asyncio.timeout(self._TIMEOUT_SECONDS):
                return await self._fetch(user_id, acute_hash=acute_hash)
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

    async def _fetch(
        self,
        user_id: str,
        acute_hash: dict[str, str] | None = None,
    ) -> EmotionSnapshot:
        acute = acute_hash or {}
        acute_emotion = str(acute.get("acute_emotion") or "neutral").lower()
        acute_risk_level = str(acute.get("acute_risk_level") or "none").lower()

        hysteresis_risk_level = "NORMAL"
        consecutive_negative_days = 0
        persistent_distress = False
        suggested_action = "NO_ACTION"
        chatbot_prompt_context: str | None = None

        # Fallback to local emotion_aggregates repo only for acute emotion label if needed
        if acute_emotion == "neutral" and self._repo is not None:
            docs = await self._repo.get_user_recent_analyses(user_id, limit=3)
            if docs:
                latest = docs[0]
                acute_emotion = (
                    latest.get("primaryEmotion")
                    or latest.get("finalEmotion")
                    or "neutral"
                ).lower()
                acute_risk_level = (
                    latest.get("mentalHealthRiskLevel") or "none"
                ).lower()
                suggested_action = latest.get("suggestedAction") or "NO_ACTION"
                neg_count = sum(
                    1
                    for d in docs
                    if (
                        d.get("primaryEmotion") or d.get("finalEmotion") or "neutral"
                    ).lower()
                    in _NEGATIVE_EMOTIONS
                )
                persistent_distress = neg_count >= 2
        elif acute_emotion == "neutral":
            from app.core.messaging import get_emotion_aggregate_repo

            repo = get_emotion_aggregate_repo()
            if repo is not None:
                docs = await repo.get_user_recent_analyses(user_id, limit=1)
                if docs:
                    latest = docs[0]
                    acute_emotion = (
                        latest.get("primaryEmotion")
                        or latest.get("finalEmotion")
                        or "neutral"
                    ).lower()
                    acute_risk_level = (
                        latest.get("mentalHealthRiskLevel") or "none"
                    ).lower()

        risk_level = _derive_legacy_risk_level(hysteresis_risk_level, acute_risk_level)

        return EmotionSnapshot(
            primary_emotion=acute_emotion,
            risk_level=risk_level,
            suggested_action=suggested_action,
            chatbot_prompt_context=chatbot_prompt_context,
            persistent_distress=persistent_distress,
            recent_trend="stable",
            hysteresis_risk_level=hysteresis_risk_level,
            acute_emotion=acute_emotion,
            acute_risk_level=acute_risk_level,
            consecutive_negative_days=consecutive_negative_days,
        )


emotion_context_service = EmotionContextService()
