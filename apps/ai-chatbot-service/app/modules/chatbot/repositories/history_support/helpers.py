from __future__ import annotations

from app.modules.chatbot.repositories.history_support.types import (
    GREETING_WORDS,
    NON_SUBSTANTIVE_INTENTS,
)
from app.utils.teencode.teencode_normalizer import teencode_normalizer


def estimate_tokens(text: str) -> int:
    words = len((text or "").split())
    return max(1, int(words * 1.35))


def is_substantive_anchor_turn(
    user_message: str,
    intent: str | None,
    policy_blocked: bool,
) -> bool:
    if policy_blocked:
        return False
    if intent in NON_SUBSTANTIVE_INTENTS:
        return False
    normalized = (
        teencode_normalizer.normalize(user_message or "").lower().strip(" .,!?…")
    )
    words = normalized.split()
    if len(words) < 4:
        return False
    if normalized in GREETING_WORDS:
        return False
    return True
