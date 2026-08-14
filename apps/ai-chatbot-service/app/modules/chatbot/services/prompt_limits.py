from __future__ import annotations

import hashlib
from dataclasses import dataclass

from app.core.settings import settings


@dataclass(frozen=True)
class PromptLimits:
    max_context_items: int
    context_char_limit: int
    max_history_items: int
    history_item_char_limit: int
    context_total_char_limit: int
    variant: str


def resolve_prompt_limits(user_id: str) -> PromptLimits:
    if not settings.CHATBOT_PROMPT_AB_TEST_ENABLED:
        return PromptLimits(
            max_context_items=settings.CHATBOT_MAX_CONTEXT_ITEMS,
            context_char_limit=settings.CHATBOT_CONTEXT_CHAR_LIMIT,
            max_history_items=settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX,
            history_item_char_limit=settings.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT,
            context_total_char_limit=settings.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT,
            variant="default",
        )

    bucket = _deterministic_bucket(user_id)
    if bucket < settings.CHATBOT_PROMPT_AB_BUCKET_RATIO:
        return PromptLimits(
            max_context_items=settings.CHATBOT_MAX_CONTEXT_ITEMS_A,
            context_char_limit=settings.CHATBOT_CONTEXT_CHAR_LIMIT_A,
            max_history_items=settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A,
            history_item_char_limit=settings.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_A,
            context_total_char_limit=settings.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_A,
            variant="A",
        )

    return PromptLimits(
        max_context_items=settings.CHATBOT_MAX_CONTEXT_ITEMS_B,
        context_char_limit=settings.CHATBOT_CONTEXT_CHAR_LIMIT_B,
        max_history_items=settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B,
        history_item_char_limit=settings.CHATBOT_PROMPT_HISTORY_ITEM_CHAR_LIMIT_B,
        context_total_char_limit=settings.CHATBOT_PROMPT_CONTEXT_TOTAL_CHAR_LIMIT_B,
        variant="B",
    )


def _deterministic_bucket(user_id: str) -> float:
    key = (user_id or "anonymous").encode("utf-8")
    digest = hashlib.sha256(key).hexdigest()[:8]
    return int(digest, 16) / 0xFFFFFFFF
