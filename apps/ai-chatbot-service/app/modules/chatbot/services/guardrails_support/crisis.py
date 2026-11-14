from __future__ import annotations

from app.utils.text_normalizer import normalize_for_guard
from .keywords import (
    _CRISIS_EXPLICIT_REGEX,
    _CRISIS_SOFT_REGEX,
    _IN_CHAT_DISTRESS_REGEX,
)
from .types import CrisisDecision


def has_in_chat_emotional_distress(text: str) -> bool:
    normalized = normalize_for_guard(text)
    if not normalized:
        return False
    return bool(_IN_CHAT_DISTRESS_REGEX.search(normalized))


class CrisisGuard:
    """Phát hiện tín hiệu khủng hoảng tâm lý (tự sát / tự làm hại bản thân)."""

    def evaluate(self, text: str) -> CrisisDecision:
        normalized = normalize_for_guard(text)
        if not normalized:
            return CrisisDecision(False, "none", "empty", normalized)

        if _CRISIS_EXPLICIT_REGEX.search(normalized):
            return CrisisDecision(True, "high", "explicit_crisis", normalized)

        if _CRISIS_SOFT_REGEX.search(normalized):
            return CrisisDecision(True, "medium", "soft_crisis", normalized)

        return CrisisDecision(False, "none", "clean", normalized)
