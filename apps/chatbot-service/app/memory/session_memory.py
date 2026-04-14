from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.core.config import settings
from app.schemas.assistant_schema import AssistantHistoryItem


@dataclass
class SessionEntry:
    expires_at: float
    history: list[AssistantHistoryItem] = field(default_factory=list)


class SessionMemory:
    def __init__(self):
        self._sessions: dict[str, SessionEntry] = {}

    def get_recent(self, key: str, limit: int) -> list[AssistantHistoryItem]:
        self._prune_expired()
        entry = self._sessions.get(key)
        if not entry:
            return []
        return entry.history[-limit:]

    def append_exchange(self, key: str, user_message: str, assistant_reply: str):
        self._prune_expired()
        now = time.time()
        entry = self._sessions.setdefault(
            key,
            SessionEntry(
                expires_at=now + settings.CHATBOT_SESSION_TTL_SECONDS,
                history=[],
            ),
        )
        entry.expires_at = now + settings.CHATBOT_SESSION_TTL_SECONDS
        entry.history.extend(
            [
                AssistantHistoryItem(role="user", content=user_message),
                AssistantHistoryItem(role="assistant", content=assistant_reply),
            ]
        )
        max_items = settings.CHATBOT_MAX_HISTORY_ITEMS * 2
        entry.history = entry.history[-max_items:]

    def _prune_expired(self):
        now = time.time()
        expired_keys = [
            key for key, entry in self._sessions.items() if entry.expires_at <= now
        ]
        for key in expired_keys:
            self._sessions.pop(key, None)


session_memory = SessionMemory()
