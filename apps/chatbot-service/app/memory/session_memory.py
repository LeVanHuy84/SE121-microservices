from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

from app.core.config import settings
from app.schemas.assistant_schema import AssistantHistoryItem, AssistantSource

logger = logging.getLogger("uvicorn.error")


@dataclass
class SessionEntry:
    expires_at: float
    history: list[AssistantHistoryItem] = field(default_factory=list)
    summary: str = ""
    last_intent: str | None = None
    last_sources: list[AssistantSource] = field(default_factory=list)


class SessionMemory:
    def __init__(self):
        self._sessions: dict[str, SessionEntry] = {}
        self._redis = None
        self._redis_unavailable_logged = False

    def get_recent(self, key: str, limit: int) -> list[AssistantHistoryItem]:
        if self._can_use_redis():
            try:
                items = self._redis.lrange(self._redis_key(key, "history"), -limit, -1)
                return [AssistantHistoryItem.model_validate_json(item) for item in items]
            except Exception as exc:
                self._disable_redis(exc)

        self._prune_expired()
        entry = self._sessions.get(key)
        if not entry:
            return []
        return entry.history[-limit:]

    def append_exchange(self, key: str, user_message: str, assistant_reply: str):
        items = [
            AssistantHistoryItem(role="user", content=user_message),
            AssistantHistoryItem(role="assistant", content=assistant_reply),
        ]
        if self._can_use_redis():
            try:
                history_key = self._redis_key(key, "history")
                self._redis.rpush(
                    history_key,
                    *[item.model_dump_json() for item in items],
                )
                self._redis.ltrim(
                    history_key,
                    -settings.CHATBOT_MEMORY_STORED_ITEMS,
                    -1,
                )
                self._expire_session_keys(key)
                return
            except Exception as exc:
                self._disable_redis(exc)

        self._prune_expired()
        entry = self._get_or_create_entry(key)
        entry.history.extend(items)
        entry.history = entry.history[-settings.CHATBOT_MEMORY_STORED_ITEMS :]

    def get_summary(self, key: str) -> str:
        if self._can_use_redis():
            try:
                return self._redis.get(self._redis_key(key, "summary")) or ""
            except Exception as exc:
                self._disable_redis(exc)

        self._prune_expired()
        entry = self._sessions.get(key)
        return entry.summary if entry else ""

    def set_summary(self, key: str, summary: str):
        normalized = " ".join(str(summary or "").split())
        if self._can_use_redis():
            try:
                self._redis.setex(
                    self._redis_key(key, "summary"),
                    settings.CHATBOT_SESSION_TTL_SECONDS,
                    normalized,
                )
                return
            except Exception as exc:
                self._disable_redis(exc)

        entry = self._get_or_create_entry(key)
        entry.summary = normalized

    def get_last_intent(self, key: str) -> str | None:
        if self._can_use_redis():
            try:
                return self._redis.get(self._redis_key(key, "last_intent"))
            except Exception as exc:
                self._disable_redis(exc)

        self._prune_expired()
        entry = self._sessions.get(key)
        return entry.last_intent if entry else None

    def set_last_intent(self, key: str, intent: str | None):
        if not intent:
            return

        if self._can_use_redis():
            try:
                self._redis.setex(
                    self._redis_key(key, "last_intent"),
                    settings.CHATBOT_SESSION_TTL_SECONDS,
                    intent,
                )
                return
            except Exception as exc:
                self._disable_redis(exc)

        entry = self._get_or_create_entry(key)
        entry.last_intent = intent

    def get_last_sources(self, key: str) -> list[AssistantSource]:
        if self._can_use_redis():
            try:
                raw = self._redis.get(self._redis_key(key, "last_sources"))
                if not raw:
                    return []
                return [
                    AssistantSource.model_validate(item)
                    for item in json.loads(raw)
                ]
            except Exception as exc:
                self._disable_redis(exc)

        self._prune_expired()
        entry = self._sessions.get(key)
        return entry.last_sources if entry else []

    def set_last_sources(self, key: str, sources: list[AssistantSource]):
        if self._can_use_redis():
            try:
                self._redis.setex(
                    self._redis_key(key, "last_sources"),
                    settings.CHATBOT_SESSION_TTL_SECONDS,
                    json.dumps([source.model_dump() for source in sources]),
                )
                return
            except Exception as exc:
                self._disable_redis(exc)

        entry = self._get_or_create_entry(key)
        entry.last_sources = sources

    def _get_or_create_entry(self, key: str) -> SessionEntry:
        now = time.time()
        entry = self._sessions.setdefault(
            key,
            SessionEntry(
                expires_at=now + settings.CHATBOT_SESSION_TTL_SECONDS,
            ),
        )
        entry.expires_at = now + settings.CHATBOT_SESSION_TTL_SECONDS
        return entry

    def _prune_expired(self):
        now = time.time()
        expired_keys = [
            key for key, entry in self._sessions.items() if entry.expires_at <= now
        ]
        for key in expired_keys:
            self._sessions.pop(key, None)

    def _can_use_redis(self) -> bool:
        if self._redis is False:
            return False

        if self._redis is not None:
            return True

        try:
            from redis import Redis

            self._redis = Redis.from_url(
                settings.CHATBOT_REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=0.2,
                socket_timeout=0.2,
            )
            self._redis.ping()
            return True
        except Exception as exc:
            self._disable_redis(exc)
            return False

    def _disable_redis(self, exc: Exception):
        self._redis = False
        if not self._redis_unavailable_logged:
            logger.warning("Assistant Redis memory disabled: %s", exc)
            self._redis_unavailable_logged = True

    def _redis_key(self, session_key: str, field: str) -> str:
        return f"{settings.CHATBOT_MEMORY_KEY_PREFIX}:{session_key}:{field}"

    def _expire_session_keys(self, session_key: str):
        for memory_field in ("history", "summary", "last_intent", "last_sources"):
            self._redis.expire(
                self._redis_key(session_key, memory_field),
                settings.CHATBOT_SESSION_TTL_SECONDS,
            )


session_memory = SessionMemory()
