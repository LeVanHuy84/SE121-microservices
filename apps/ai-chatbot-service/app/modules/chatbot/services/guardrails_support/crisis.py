from __future__ import annotations

from app.utils.text_normalizer import normalize_for_guard
from .keywords import (
    _ACUTE_PFA_DISTRESS_REGEX,
    _CRISIS_EXPLICIT_REGEX,
    _CRISIS_SOFT_REGEX,
    _MILD_CBT_DISTRESS_REGEX,
)
from .types import CrisisDecision, DistressLevel


def classify_in_chat_distress_level(text: str) -> DistressLevel:
    normalized = normalize_for_guard(text)
    if not normalized:
        return "none"
    if _ACUTE_PFA_DISTRESS_REGEX.search(normalized):
        return "acute_pfa"
    if _MILD_CBT_DISTRESS_REGEX.search(normalized):
        return "mild_cbt"
    return "none"


def has_in_chat_emotional_distress(text: str) -> bool:
    return classify_in_chat_distress_level(text) != "none"


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
