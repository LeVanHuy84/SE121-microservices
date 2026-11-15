from __future__ import annotations

from app.utils.text_normalizer import normalize_for_guard
from .keywords import PROFANITY_REGEX, UNSAFE_REGEX
from .types import CommunityDecision


class CommunityGuard:
    def evaluate(self, text: str) -> CommunityDecision:
        normalized = normalize_for_guard(text)
        if not normalized:
            return CommunityDecision(True, "empty", "none", normalized)

        if UNSAFE_REGEX.search(normalized):
            return CommunityDecision(
                False,
                "unsafe_content",
                "high",
                normalized,
            )
        if PROFANITY_REGEX.search(normalized):
            return CommunityDecision(
                False,
                "profanity_candidate",
                "medium",
                normalized,
            )
        return CommunityDecision(True, "clean", "none", normalized)
