from __future__ import annotations

from datetime import datetime
from typing import Any

from app.modules.chatbot.repositories.history_support.store import HistoryStore
from app.modules.chatbot.repositories.history_support.types import PersistResult
from app.modules.chatbot.schemas import (
    AssistantHistoryPageData,
    AssistantRespondRequest,
    AssistantSource,
)


class ClearHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(self, user_id: str) -> int:
        return await self.store.purge_user_data(user_id, include_emotion_cache=False)


class GetHistoryQuery:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
        conversation_id: str | None = None,
    ) -> AssistantHistoryPageData:
        return await self.store.get_messages_page_by_user(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
            conversation_id=conversation_id,
        )


class ListConversationsQuery:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        return await self.store.list_conversations_by_user(user_id=user_id, limit=limit)


class CreateConversationCommand:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(self, user_id: str, title: str | None = None) -> dict[str, Any]:
        return await self.store.create_conversation(user_id=user_id, title=title)


class DeleteConversationCommand:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(self, user_id: str, conversation_id: str) -> bool:
        return await self.store.delete_conversation(
            user_id=user_id, conversation_id=conversation_id
        )


class PersistHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self._store = store

    @property
    def store(self) -> HistoryStore:
        if self._store is None:
            from app.modules.chatbot.repositories.chat_history import history_store

            return history_store
        return self._store

    async def execute(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
        actions: list[Any] | None = None,
        policy_blocked: bool = False,
        session_emotional_state: dict[str, Any] | None = None,
    ) -> PersistResult:
        if not self.store.is_enabled():
            return PersistResult(persisted=False)

        return await self.store.persist_exchange(
            user_id=request.userId,
            user_message=request.message,
            assistant_reply=assistant_reply,
            intent=intent,
            sources=sources,
            client_message_id=request.clientMessageId
            or getattr(request, "requestId", None),
            actions=actions,
            conversation_id=request.conversationId,
            policy_blocked=policy_blocked,
            session_emotional_state=session_emotional_state,
        )
