from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from app.core.config import settings
from app.repositories.chat_history_repository import ChatHistoryRepository
from app.schemas.assistant_schema import (
    AssistantHistoryMessage,
    AssistantHistoryPageData,
    AssistantSource,
)

logger = logging.getLogger("uvicorn.error")


class ChatHistoryService:
    def __init__(self, repository: ChatHistoryRepository | None = None):
        self._repository = repository or ChatHistoryRepository()

    def is_enabled(self) -> bool:
        return settings.CHATBOT_DB_ENABLED

    async def append_exchange(
        self,
        user_id: str,
        user_message: str,
        assistant_reply: str,
        intent: str | None,
        sources: list[AssistantSource],
        client_message_id: str | None = None,
    ):
        if not self.is_enabled():
            return

        serialized_sources = [item.model_dump() for item in sources]
        return await self._repository.append_exchange(
            user_id=user_id,
            user_message=user_message,
            assistant_reply=assistant_reply,
            intent=intent,
            sources=serialized_sources,
            client_message_id=client_message_id,
        )

    async def get_messages_page_by_user(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> AssistantHistoryPageData:
        self._ensure_enabled()

        if (before_created_at is None) != (before_id is None):
            raise ValueError("before_created_at and before_id must be provided together")

        resolved_page_size = self._resolve_page_size(page_size)
        messages, has_more = await self._repository.list_messages_by_user(
            user_id=user_id,
            page_size=resolved_page_size,
            before_created_at=before_created_at,
            before_id=before_id,
        )

        items = [self._to_history_message(item) for item in messages]
        next_cursor_created_at = None
        next_cursor_id = None
        if has_more and items:
            next_cursor_created_at = items[-1].created_at
            next_cursor_id = items[-1].id

        return AssistantHistoryPageData(
            items=items,
            next_cursor_created_at=next_cursor_created_at,
            next_cursor_id=next_cursor_id,
            has_more=has_more,
        )

    async def clear_history_by_user(self, user_id: str) -> int:
        self._ensure_enabled()
        return await self._repository.clear_history_by_user(user_id)

    def _resolve_page_size(self, requested_page_size: int | None) -> int:
        value = requested_page_size or settings.CHATBOT_HISTORY_PAGE_SIZE_DEFAULT
        if value <= 0:
            raise ValueError("page_size must be positive")
        return min(value, settings.CHATBOT_HISTORY_PAGE_SIZE_MAX)

    def _ensure_enabled(self):
        if not self.is_enabled():
            raise RuntimeError("Chatbot DB is disabled")

    def _to_history_message(self, message: Any) -> AssistantHistoryMessage:
        raw_sources = message.sources or []
        parsed_sources = [
            AssistantSource.model_validate(item)
            for item in raw_sources
            if isinstance(item, dict)
        ]

        return AssistantHistoryMessage(
            id=str(message.id),
            conversation_id=str(message.conversation_id),
            user_id=message.user_id,
            role=message.role,
            content=message.content,
            intent=message.intent,
            sources=parsed_sources,
            metadata=message.meta or {},
            created_at=message.created_at,
        )


chat_history_service = ChatHistoryService()
