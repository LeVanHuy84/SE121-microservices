from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CrisisDecision:
    is_crisis: bool
    severity: str  # "high" | "medium" | "none"
    reason: str
    normalized_text: str


@dataclass(frozen=True)
class CommunityDecision:
    allowed: bool
    reason: str
    severity: str
    normalized_text: str


@dataclass(frozen=True)
class ScopeDecision:
    in_scope: bool
    reason: str
    normalized_text: str
    state: str
    confidence: float
    matched_domains: tuple[str, ...]
