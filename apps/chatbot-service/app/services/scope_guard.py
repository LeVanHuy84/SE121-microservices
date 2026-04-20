from __future__ import annotations

import re
import unicodedata

from app.schemas.assistant_schema import AssistantRespondRequest
from app.services.scope_keywords import GREETINGS, KEYWORD_GROUPS


class AssistantScopeGuard:
    def is_in_scope(self, request: AssistantRespondRequest) -> bool:
        if request.contexts:
            return True

        text = self._normalize(request.message)
        if not text:
            return False

        if text in GREETINGS:
            return True

        return any(
            self._matches_any_keyword(text, keywords)
            for keywords in KEYWORD_GROUPS
        )

    def _normalize(self, value: str) -> str:
        normalized = unicodedata.normalize("NFD", value or "")
        normalized = "".join(
            char for char in normalized if unicodedata.category(char) != "Mn"
        )
        normalized = normalized.replace("đ", "d").replace("Đ", "d").lower()
        return re.sub(r"[^a-z0-9]+", " ", normalized).strip()

    def _matches_any_keyword(self, text: str, keywords: set[str]) -> bool:
        return any(
            re.search(rf"(^|\s){re.escape(keyword)}($|\s)", text) is not None
            for keyword in keywords
        )


assistant_scope_guard = AssistantScopeGuard()
