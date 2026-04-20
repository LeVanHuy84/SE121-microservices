from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, delete, desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.models import ChatConversation, ChatMessage
from app.db.session import get_session_factory


class ChatHistoryRepository:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession] | None = None):
        self._session_factory = session_factory

    async def get_or_create_conversation_by_user(self, user_id: str) -> ChatConversation:
        async with self._session_factory() as session:
            conversation = await self._get_conversation(session, user_id)
            if conversation:
                return conversation

            conversation = ChatConversation(user_id=user_id)
            session.add(conversation)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                existing = await self._get_conversation(session, user_id)
                if existing:
                    return existing
                raise

            await session.refresh(conversation)
            return conversation

    async def append_message(
        self,
        user_id: str,
        role: str,
        content: str,
        intent: str | None = None,
        sources: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ChatMessage:
        async with self._session_factory() as session:
            conversation = await self._get_conversation(session, user_id)
            if not conversation:
                conversation = ChatConversation(user_id=user_id)
                session.add(conversation)
                try:
                    await session.flush()
                except IntegrityError:
                    await session.rollback()
                    conversation = await self._get_conversation(session, user_id)
                    if not conversation:
                        raise

            now = datetime.now(timezone.utc)
            message = ChatMessage(
                conversation_id=conversation.id,
                user_id=user_id,
                role=role,
                content=content,
                intent=intent,
                sources=sources or [],
                meta=metadata or {},
                created_at=now,
            )
            conversation.last_message_at = now
            session.add(message)
            await session.commit()
            await session.refresh(message)
            return message

    async def list_messages_by_user(
        self,
        user_id: str,
        page_size: int,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> tuple[list[ChatMessage], bool]:
        async with self._session_factory() as session:
            conversation = await self._get_conversation(session, user_id)
            if not conversation:
                return [], False

            query = select(ChatMessage).where(ChatMessage.conversation_id == conversation.id)

            if before_created_at and before_id:
                cursor_id = UUID(before_id)
                query = query.where(
                    or_(
                        ChatMessage.created_at < before_created_at,
                        and_(
                            ChatMessage.created_at == before_created_at,
                            ChatMessage.id < cursor_id,
                        ),
                    )
                )

            query = query.order_by(desc(ChatMessage.created_at), desc(ChatMessage.id)).limit(
                page_size + 1
            )
            result = await session.execute(query)
            rows = list(result.scalars().all())

            has_more = len(rows) > page_size
            if has_more:
                rows = rows[:page_size]

            return rows, has_more

    async def clear_history_by_user(self, user_id: str) -> int:
        async with self._session_factory() as session:
            conversation = await self._get_conversation(session, user_id)
            if not conversation:
                return 0

            result = await session.execute(
                delete(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
            )
            conversation.last_message_at = None
            await session.commit()

            return int(result.rowcount or 0)

    async def _get_conversation(
        self,
        session: AsyncSession,
        user_id: str,
    ) -> ChatConversation | None:
        result = await session.execute(
            select(ChatConversation).where(ChatConversation.user_id == user_id)
        )
        return result.scalar_one_or_none()

    @property
    def _session_factory(self) -> async_sessionmaker[AsyncSession]:
        if self.__session_factory is None:
            self.__session_factory = get_session_factory()
        return self.__session_factory

    @_session_factory.setter
    def _session_factory(self, value: async_sessionmaker[AsyncSession] | None):
        self.__session_factory = value
