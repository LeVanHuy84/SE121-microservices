from __future__ import annotations

from app.utils.text_normalizer import normalize_for_guard
from .keywords import (
    _ACUTE_PFA_DISTRESS_REGEX,
    _CRISIS_SOFT_REGEX,
    _MILD_CBT_DISTRESS_REGEX,
    evaluate_explicit_crisis,
)
from .types import CrisisDecision, DistressLevel


def classify_in_chat_distress_level(text: str) -> DistressLevel:
    normalized = normalize_for_guard(text)
    if not normalized:
        return "none"
    if _ACUTE_PFA_DISTRESS_REGEX.search(normalized) or _CRISIS_SOFT_REGEX.search(normalized):
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

        is_explicit, reason = evaluate_explicit_crisis(normalized)
        if is_explicit:
            return CrisisDecision(True, "high", reason, normalized)

        if reason == "negated_crisis":
            return CrisisDecision(False, "none", "negated_crisis", normalized)

        # Soft crisis keywords: không tự ngắt ở Step 0 mà để PFA / PhoBERT thẩm định ngữ cảnh
        if _CRISIS_SOFT_REGEX.search(normalized):
            return CrisisDecision(False, "medium", "soft_distress", normalized)

        return CrisisDecision(False, "none", "clean", normalized)
