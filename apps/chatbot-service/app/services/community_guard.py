from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


PROFANITY_KEYWORDS = {
    "dit",
    "dm",
    "dmm",
    "vl",
    "vcl",
    "cc",
    "lon",
    "cac",
    "me may",
    "bo may",
    "deo",
    "clm",
}

COMMUNITY_UNSAFE_KEYWORDS = {
    "khung bo",
    "danh bom",
    "giet nguoi",
    "hiep dam",
    "au dam tre em",
    "child porn",
    "terrorist",
    "bomb",
    "kill someone",
}


@dataclass(frozen=True)
class CommunityDecision:
    allowed: bool
    reason: str
    severity: str
    normalized_text: str


class CommunityGuard:
    def evaluate(self, text: str) -> CommunityDecision:
        normalized = self._normalize(text)
        if not normalized:
            return CommunityDecision(True, "empty", "none", normalized)

        profanity_hits = self._count_hits(normalized, PROFANITY_KEYWORDS)
        unsafe_hits = self._count_hits(normalized, COMMUNITY_UNSAFE_KEYWORDS)

        if unsafe_hits > 0:
            return CommunityDecision(
                False,
                "community_violation",
                "high",
                normalized,
            )
        if profanity_hits > 0:
            return CommunityDecision(
                False,
                "profanity",
                "medium",
                normalized,
            )
        return CommunityDecision(True, "clean", "none", normalized)

    def _normalize(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", value or "")
        normalized = "".join(
            char for char in normalized if unicodedata.category(char) != "Mn"
        )
        normalized = normalized.replace("\u0111", "d").replace("\u0110", "d").lower()
        normalized = re.sub(r"[^a-z0-9\s]+", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized

    def _count_hits(self, text: str, keywords: set[str]) -> int:
        hit = 0
        for keyword in keywords:
            if re.search(rf"(^|\s){re.escape(keyword)}($|\s)", text):
                hit += 1
        return hit


assistant_community_guard = CommunityGuard()

