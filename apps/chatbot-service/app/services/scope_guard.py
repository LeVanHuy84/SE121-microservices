from __future__ import annotations

import re
import unicodedata

from app.schemas.assistant_schema import AssistantRespondRequest


class AssistantScopeGuard:
    _SYSTEM_KEYWORDS = {
        "sentimeta",
        "se121",
        "app",
        "ung dung",
        "he thong",
        "tinh nang",
        "mang xa hoi",
        "social",
        "assistant",
        "chatbot",
        "rag",
    }

    _CHAT_KEYWORDS = {
        "chat",
        "tin nhan",
        "conversation",
        "message",
    }

    _POST_KEYWORDS = {
        "bai viet",
        "post",
        "noi dung",
    }

    _GROUP_KEYWORDS = {
        "group",
        "nhom",
        "cong dong",
    }

    _SEARCH_KEYWORDS = {
        "search",
        "tim kiem",
    }

    _USER_KEYWORDS = {
        "user",
        "nguoi dung",
        "profile",
        "ho so",
        "ban be",
        "ket ban",
        "goi y",
        "recommend",
        "recommendation",
    }

    _PRIVACY_KEYWORDS = {
        "quyen rieng tu",
        "privacy",
    }

    _NOTIFICATION_KEYWORDS = {
        "thong bao",
        "notification",
    }

    _EMOTION_KEYWORDS = {
        "cam xuc",
        "emotion",
    }

    _KEYWORD_GROUPS = (
        _SYSTEM_KEYWORDS,
        _CHAT_KEYWORDS,
        _POST_KEYWORDS,
        _GROUP_KEYWORDS,
        _SEARCH_KEYWORDS,
        _USER_KEYWORDS,
        _PRIVACY_KEYWORDS,
        _NOTIFICATION_KEYWORDS,
        _EMOTION_KEYWORDS,
    )

    _GREETINGS = {
        "hi",
        "hello",
        "hey",
        "xin chao",
        "chao",
    }

    def is_in_scope(self, request: AssistantRespondRequest) -> bool:
        if request.contexts:
            return True

        text = self._normalize(request.message)
        if not text:
            return False

        if text in self._GREETINGS:
            return True

        return any(
            self._matches_any_keyword(text, keywords)
            for keywords in self._KEYWORD_GROUPS
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
