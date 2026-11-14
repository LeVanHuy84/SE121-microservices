from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.modules.chatbot.schemas import AssistantHistoryPageData

MAX_SESSIONS_PER_USER: int = 20
SESSION_TTL_SECONDS: int = 90 * 24 * 3600  # 90 days
TOKEN_BUDGET_FULL_HISTORY: int = 1500
TOKEN_CEILING_HARD: int = 2000
HISTORY_MESSAGE_CHAR_CAP: int = 1200
GAP_MARKER_TEXT: str = "[... Một số lượt trao đổi trung gian đã được lược bớt ...]"

NON_SUBSTANTIVE_INTENTS: frozenset[str] = frozenset(
    {
        "greeting",
        "mental_health_crisis",
        "community_guard",
        "out_of_scope",
        "privacy",
        "in_domain_unknown",
        "clarify",
    }
)

GREETING_WORDS: frozenset[str] = frozenset(
    {
        "xin chào",
        "chào bạn",
        "chào",
        "hi",
        "hello",
        "hey",
        "alo",
    }
)


@dataclass
class ExchangeResult:
    user_message: dict[str, Any]
    assistant_message: dict[str, Any]
    locked_anchor_this_turn: bool = False
    turn_count: int = 0

    def __iter__(self):
        return iter(
            (
                self.user_message,
                self.assistant_message,
                self.locked_anchor_this_turn,
                self.turn_count,
            )
        )

    def __getitem__(self, index: int):
        if index == 0:
            return self.user_message
        if index == 1:
            return self.assistant_message
        if index == 2:
            return self.locked_anchor_this_turn
        if index == 3:
            return self.turn_count
        raise IndexError("Index out of range")

    def __len__(self) -> int:
        return 4


@dataclass
class PersistResult:
    persisted: bool
    turn_count: int = 0
    locked_anchor_this_turn: bool = False

    def __bool__(self) -> bool:
        return self.persisted


@dataclass
class _HistoryCacheEntry:
    expires_at: float
    value: AssistantHistoryPageData
