from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

DistressLevel = Literal["none", "mild_cbt", "acute_pfa"]


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


@dataclass(frozen=True)
class Stage2VerificationResult:
    in_scope_override: bool | None = None
    matched_domains_override: tuple[str, ...] | None = None
    community_allowed_override: bool | None = None
    crisis_decision_override: CrisisDecision | None = None
    distress_level: DistressLevel = "none"
    phobert_scores: dict[str, float] = field(default_factory=dict)
