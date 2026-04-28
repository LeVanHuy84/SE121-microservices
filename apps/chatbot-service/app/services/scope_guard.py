from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.schemas.assistant_schema import AssistantHistoryItem, AssistantRespondRequest
from app.services.scope_keywords import (
    FOLLOW_UP_REFERENCE_KEYWORDS,
    GREETINGS,
    KEYWORD_GROUPS,
)


@dataclass(frozen=True)
class ScopeDecision:
    in_scope: bool
    reason: str
    normalized_text: str


class AssistantScopeGuard:
    def evaluate_scope(
        self,
        request: AssistantRespondRequest,
        *,
        last_intent: str | None = None,
        recent_history: list[AssistantHistoryItem] | None = None,
    ) -> ScopeDecision:
        normalized_text = self._normalize(request.message)

        if request.contexts:
            return ScopeDecision(True, "has_contexts", normalized_text)

        if not normalized_text:
            return ScopeDecision(False, "empty_message", normalized_text)

        if normalized_text in GREETINGS:
            return ScopeDecision(True, "greeting", normalized_text)

        if self._looks_like_identity_or_capability_question(normalized_text):
            return ScopeDecision(True, "identity_or_capability", normalized_text)

        for keywords in KEYWORD_GROUPS:
            if self._matches_any_keyword(normalized_text, keywords):
                return ScopeDecision(True, "matched_keyword_group", normalized_text)

        if self._looks_like_follow_up(
            normalized_text,
            last_intent=last_intent,
            recent_history=recent_history or request.history,
        ):
            return ScopeDecision(True, "follow_up_reference", normalized_text)

        return ScopeDecision(False, "no_scope_signal", normalized_text)

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
        return re.sub(r"[^a-z0-9]+", " ", normalized).strip()

    def _matches_any_keyword(self, text: str, keywords: set[str]) -> bool:
        return any(
            re.search(rf"(^|\s){re.escape(keyword)}($|\s)", text) is not None
            for keyword in keywords
        )

    def _looks_like_follow_up(
        self,
        text: str,
        *,
        last_intent: str | None,
        recent_history: list[AssistantHistoryItem] | None,
    ) -> bool:
        if len(text.split()) > 18:
            return False

        if self._looks_like_identity_or_capability_question(text):
            return True

        has_contextual_anchor = bool(last_intent) or self._history_has_scope_signal(
            recent_history
        )

        if self._looks_like_pronoun_follow_up(text):
            if not has_contextual_anchor:
                return False
            return True

        strong_reference_keywords = {
            "chuc nang tren",
            "tinh nang tren",
            "cai tren",
            "cai do",
            "cai nay",
            "phan tren",
            "phan do",
            "phan nay",
            "muc tren",
            "muc do",
            "muc nay",
            "chuc nang do",
            "tinh nang do",
            "chuc nang nay",
            "tinh nang nay",
            "that feature",
            "this feature",
            "that part",
            "this part",
            "that section",
            "this section",
        }
        if self._matches_any_keyword(text, strong_reference_keywords):
            return True

        if not has_contextual_anchor:
            return False

        return self._matches_any_keyword(text, FOLLOW_UP_REFERENCE_KEYWORDS)

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
            for keywords in KEYWORD_GROUPS:
                if self._matches_any_keyword(normalized, keywords):
                    return True
        return False


assistant_scope_guard = AssistantScopeGuard()
