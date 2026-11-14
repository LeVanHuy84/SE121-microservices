from __future__ import annotations

from app.utils.text_normalizer import normalize_for_guard
from .guardrails_support import (
    COMMUNITY_UNSAFE_KEYWORDS,
    CRISIS_EXPLICIT_KEYWORDS,
    CRISIS_SOFT_KEYWORDS,
    DOMAIN_KEYWORD_GROUPS,
    FEATURE_QUERY_KEYWORDS,
    FOLLOW_UP_REFERENCE_KEYWORDS,
    GREETINGS,
    IN_CHAT_DISTRESS_KEYWORDS,
    PROFANITY_KEYWORDS,
    PROFANITY_REGEX,
    STRONG_REFERENCE_KEYWORDS,
    UNSAFE_REGEX,
    _CRISIS_EXPLICIT_REGEX,
    _CRISIS_SOFT_REGEX,
    _IN_CHAT_DISTRESS_REGEX,
    AssistantScopeGuard,
    CommunityDecision,
    CommunityGuard,
    CrisisDecision,
    CrisisGuard,
    DomainKeywordGroup,
    ScopeDecision,
    has_in_chat_emotional_distress,
)

assistant_crisis_guard = CrisisGuard()
assistant_community_guard = CommunityGuard()
assistant_scope_guard = AssistantScopeGuard()

__all__ = [
    "COMMUNITY_UNSAFE_KEYWORDS",
    "CRISIS_EXPLICIT_KEYWORDS",
    "CRISIS_SOFT_KEYWORDS",
    "DOMAIN_KEYWORD_GROUPS",
    "FEATURE_QUERY_KEYWORDS",
    "FOLLOW_UP_REFERENCE_KEYWORDS",
    "GREETINGS",
    "IN_CHAT_DISTRESS_KEYWORDS",
    "PROFANITY_KEYWORDS",
    "PROFANITY_REGEX",
    "STRONG_REFERENCE_KEYWORDS",
    "UNSAFE_REGEX",
    "_CRISIS_EXPLICIT_REGEX",
    "_CRISIS_SOFT_REGEX",
    "_IN_CHAT_DISTRESS_REGEX",
    "AssistantScopeGuard",
    "CommunityDecision",
    "CommunityGuard",
    "CrisisDecision",
    "CrisisGuard",
    "DomainKeywordGroup",
    "ScopeDecision",
    "assistant_community_guard",
    "assistant_crisis_guard",
    "assistant_scope_guard",
    "has_in_chat_emotional_distress",
    "normalize_for_guard",
]
