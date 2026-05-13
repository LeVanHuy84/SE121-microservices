from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.schemas.assistant_schema import AssistantHistoryItem, AssistantRespondRequest
from app.services.scope_keywords import (
    DOMAIN_KEYWORD_GROUPS,
    FEATURE_QUERY_KEYWORDS,
    FOLLOW_UP_REFERENCE_KEYWORDS,
    GREETINGS,
    STRONG_REFERENCE_KEYWORDS,
    TEENCODE_MAP,
)


@dataclass(frozen=True)
class ScopeDecision:
    in_scope: bool
    reason: str
    normalized_text: str
    state: str
    confidence: float
    matched_domains: tuple[str, ...]


class AssistantScopeGuard:
    def evaluate_scope(
        self,
        request: AssistantRespondRequest,
        *,
        last_intent: str | None = None,
        recent_history: list[AssistantHistoryItem] | None = None,
    ) -> ScopeDecision:
        normalized_text = self._normalize(request.message)
        if not normalized_text:
            return ScopeDecision(False, "empty_message", normalized_text, "out_of_scope", 0.0, ())

        if normalized_text in GREETINGS:
            return ScopeDecision(True, "greeting", normalized_text, "in_scope", 1.0, ("system",))

        if request.contexts:
            return ScopeDecision(True, "has_contexts", normalized_text, "in_scope", 0.95, ("system",))

        if self._looks_like_identity_or_capability_question(normalized_text):
            return ScopeDecision(
                True,
                "identity_or_capability",
                normalized_text,
                "in_scope",
                0.9,
                ("system",),
            )

        domain_scores = self._compute_domain_scores(normalized_text)
        matched_domains = tuple(sorted(k for k, v in domain_scores.items() if v > 0))
        history_items = recent_history or request.history
        nearest_history_domains = self._nearest_history_domains(history_items)
        if self._looks_like_pronoun_follow_up(normalized_text) and nearest_history_domains:
            merged = list(dict.fromkeys([*matched_domains, *nearest_history_domains]))
            matched_domains = tuple(merged)
        ranked_scores = sorted(domain_scores.values(), reverse=True)
        best_score = ranked_scores[0] if ranked_scores else 0.0
        blended_domain_score = best_score
        if len(ranked_scores) > 1:
            blended_domain_score = min(1.0, best_score + (ranked_scores[1] * 0.45))

        has_any_history = bool(history_items)
        has_contextual_anchor = bool(last_intent) or self._history_has_scope_signal(
            history_items
        )
        follow_up_score = self._follow_up_score(
            normalized_text,
            has_contextual_anchor=has_contextual_anchor,
            has_any_history=has_any_history,
        )

        final_score = min(1.0, max(blended_domain_score, follow_up_score))
        if self._looks_like_feature_question(normalized_text) and (
            bool(matched_domains) or has_contextual_anchor
        ):
            return ScopeDecision(
                False,
                "feature_question_in_domain_unknown",
                normalized_text,
                "in_domain_unknown",
                round(max(final_score, 0.35), 4),
                matched_domains,
            )
        in_domain_signal = self._has_in_domain_signal(
            normalized_text,
            blended_domain_score=blended_domain_score,
            matched_domains=matched_domains,
            has_contextual_anchor=has_contextual_anchor,
        )
        if final_score >= 0.4:
            return ScopeDecision(
                True,
                "scored_in_scope",
                normalized_text,
                "in_scope",
                round(final_score, 4),
                matched_domains,
            )
        if in_domain_signal:
            return ScopeDecision(
                False,
                "in_domain_unknown",
                normalized_text,
                "in_domain_unknown",
                round(max(final_score, blended_domain_score, 0.2), 4),
                matched_domains,
            )
        if final_score <= 0.15:
            return ScopeDecision(
                False,
                "scored_out_of_scope",
                normalized_text,
                "out_of_scope",
                round(final_score, 4),
                matched_domains,
            )
        return ScopeDecision(
            False,
            "scored_ambiguous",
            normalized_text,
            "ambiguous",
            round(final_score, 4),
            matched_domains,
        )

    def is_in_scope(
        self,
        request: AssistantRespondRequest,
        *,
        last_intent: str | None = None,
        recent_history: list[AssistantHistoryItem] | None = None,
    ) -> bool:
        return self.evaluate_scope(
            request,
            last_intent=last_intent,
            recent_history=recent_history,
        ).in_scope

    def _normalize(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", value or "")
        normalized = "".join(
            char for char in normalized if unicodedata.category(char) != "Mn"
        )
        normalized = normalized.replace("\u0111", "d").replace("\u0110", "d").lower()
        normalized = re.sub(r"[^a-z0-9\s]+", " ", normalized)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        tokens = [TEENCODE_MAP.get(token, token) for token in normalized.split()]
        return " ".join(tokens)

    def _matches_any_keyword(self, text: str, keywords: set[str]) -> bool:
        return any(
            re.search(rf"(^|\s){re.escape(keyword)}($|\s)", text) is not None
            for keyword in keywords
        )

    def _compute_domain_scores(self, text: str) -> dict[str, float]:
        scores: dict[str, float] = {}
        token_count = max(1, len(text.split()))
        for group in DOMAIN_KEYWORD_GROUPS:
            hit = 0
            score = 0.0
            for keyword in group.keywords:
                if self._matches_any_keyword(text, {keyword}):
                    hit += 1
                    if len(keyword.split()) >= 2:
                        score += 0.35
                    else:
                        score += 0.22
            if hit:
                score += min(0.25, hit / token_count)
            scores[group.domain] = min(1.0, score)
        return scores

    def _follow_up_score(
        self,
        text: str,
        *,
        has_contextual_anchor: bool,
        has_any_history: bool,
    ) -> float:
        if len(text.split()) > 18:
            return 0.0
        if has_any_history and len(text.split()) <= 7 and self._looks_like_pronoun_follow_up(text):
            return 0.7
        if has_contextual_anchor and len(text.split()) <= 12:
            # Short follow-ups after an existing conversation are usually in-scope.
            if any(token in text for token in ("no", "do", "nay", "them", "tiep")):
                return 0.74
        if self._looks_like_pronoun_follow_up(text):
            return 0.82 if has_contextual_anchor else 0.25
        if self._matches_any_keyword(text, STRONG_REFERENCE_KEYWORDS):
            return 0.72
        if self._matches_any_keyword(text, FOLLOW_UP_REFERENCE_KEYWORDS):
            return 0.78 if has_contextual_anchor else 0.33
        return 0.0

    def _looks_like_identity_or_capability_question(self, text: str) -> bool:
        if not text:
            return False
        if re.search(r"(^| )ban( .*?)? la ai($| )", text):
            return True
        if re.search(r"(^| )who are you($| )", text):
            return True
        if re.search(r"(^| )what can you do($| )", text):
            return True
        capability_phrases = (
            "ban lam duoc gi",
            "ban co the lam gi",
            "ban giup duoc gi",
            "ban ho tro gi",
            "co the giup gi",
        )
        return any(phrase in text for phrase in capability_phrases)

    def _looks_like_pronoun_follow_up(self, text: str) -> bool:
        if len(text.split()) > 10:
            return False
        pronoun_patterns = (
            r"^no( la gi| nhu nao| sao)?$",
            r"^no( nhu the nao| hoat dong sao| dung sao)?$",
            r"^(dung|su dung) no( nhu the nao| sao)?$",
            r"^huong dan (dung|su dung) no$",
            r"^cai do( la gi| nhu nao| sao)?$",
            r"^cai nay( la gi| nhu nao| sao)?$",
            r"^nhu tren( la sao| la gi)?$",
            r"^nhu vay( la sao| la gi)?$",
        )
        return any(re.search(pattern, text) is not None for pattern in pronoun_patterns)

    def _history_has_scope_signal(
        self,
        recent_history: list[AssistantHistoryItem] | None,
    ) -> bool:
        if not recent_history:
            return False
        tail = recent_history[-4:]
        for item in tail:
            normalized = self._normalize(item.content)
            if not normalized:
                continue
            if self._looks_like_identity_or_capability_question(normalized):
                return True
            if self._matches_any_keyword(normalized, FOLLOW_UP_REFERENCE_KEYWORDS):
                return True
            for group in DOMAIN_KEYWORD_GROUPS:
                if self._matches_any_keyword(normalized, group.keywords):
                    return True
        return False

    def _nearest_history_domains(
        self,
        recent_history: list[AssistantHistoryItem] | None,
    ) -> tuple[str, ...]:
        if not recent_history:
            return ()
        for item in reversed(recent_history[-8:]):
            if item.role != "user":
                continue
            normalized = self._normalize(item.content)
            if not normalized:
                continue
            scores = self._compute_domain_scores(normalized)
            domains = tuple(sorted(k for k, v in scores.items() if v > 0))
            if domains:
                return domains
        return ()

    def _has_in_domain_signal(
        self,
        text: str,
        *,
        blended_domain_score: float,
        matched_domains: tuple[str, ...],
        has_contextual_anchor: bool,
    ) -> bool:
        if blended_domain_score >= 0.22 and bool(matched_domains):
            return True
        if has_contextual_anchor and self._looks_like_pronoun_follow_up(text):
            return True
        return False

    def _looks_like_feature_question(self, text: str) -> bool:
        if not text:
            return False
        if self._matches_any_keyword(text, FEATURE_QUERY_KEYWORDS):
            return True
        return bool(
            re.search(
                r"\b(co|ho tro|cho phep|hien tai)\b.*\b(chuc nang|tinh nang|feature)\b",
                text,
            )
        )


assistant_scope_guard = AssistantScopeGuard()
