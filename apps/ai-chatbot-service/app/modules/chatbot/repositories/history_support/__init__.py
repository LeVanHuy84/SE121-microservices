"""History repository support submodules."""

from app.modules.chatbot.repositories.history_support.types import (
    GAP_MARKER_TEXT,
    GREETING_WORDS,
    HISTORY_MESSAGE_CHAR_CAP,
    MAX_SESSIONS_PER_USER,
    NON_SUBSTANTIVE_INTENTS,
    SESSION_TTL_SECONDS,
    TOKEN_BUDGET_FULL_HISTORY,
    TOKEN_CEILING_HARD,
    ExchangeResult,
    PersistResult,
    _HistoryCacheEntry,
)
from app.modules.chatbot.repositories.history_support.helpers import (
    estimate_tokens,
    is_substantive_anchor_turn,
)
from app.modules.chatbot.repositories.history_support.repository import (
    ChatHistoryRepository,
)
from app.modules.chatbot.repositories.history_support.store import (
    HistoryStore,
)
from app.modules.chatbot.repositories.history_support.commands import (
    ClearHistoryCommand,
    CreateConversationCommand,
    DeleteConversationCommand,
    GetHistoryQuery,
    ListConversationsQuery,
    PersistHistoryCommand,
)

__all__ = [
    "MAX_SESSIONS_PER_USER",
    "SESSION_TTL_SECONDS",
    "TOKEN_BUDGET_FULL_HISTORY",
    "TOKEN_CEILING_HARD",
    "HISTORY_MESSAGE_CHAR_CAP",
    "GAP_MARKER_TEXT",
    "NON_SUBSTANTIVE_INTENTS",
    "GREETING_WORDS",
    "ExchangeResult",
    "PersistResult",
    "_HistoryCacheEntry",
    "estimate_tokens",
    "is_substantive_anchor_turn",
    "ChatHistoryRepository",
    "HistoryStore",
    "ClearHistoryCommand",
    "GetHistoryQuery",
    "ListConversationsQuery",
    "CreateConversationCommand",
    "DeleteConversationCommand",
    "PersistHistoryCommand",
]
