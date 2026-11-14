from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime
from typing import Any

from app.core.settings import settings
from app.modules.chatbot.repositories.history_support.repository import (
    ChatHistoryRepository,
)
from app.modules.chatbot.repositories.history_support.types import (
    PersistResult,
    _HistoryCacheEntry,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    UserMemoryProfileRepository,
    user_memory_profile_repo,
)
from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantHistoryMessage,
    AssistantHistoryPageData,
    AssistantSource,
)

logger = logging.getLogger("uvicorn.error")


class HistoryStore:
    def __init__(
        self,
        repository: ChatHistoryRepository | None = None,
        profile_repo: UserMemoryProfileRepository | None = None,
    ):
        self._repository = repository or ChatHistoryRepository()
        self.profile_repo = profile_repo or user_memory_profile_repo
        self._history_cache: dict[tuple[str, str, int], _HistoryCacheEntry] = {}
        self.fact_extractor: Any = None
        self._sweeper_task: asyncio.Task[None] | None = None

    def is_enabled(self) -> bool:
        if (
            self._repository is not None
            and getattr(self._repository, "_db", None) is not None
        ):
            return True
        return settings.CHATBOT_DB_ENABLED

    async def start(self):
        # Sweeper loop is started in lifespan; start() kept for interface stability
        return

    async def stop(self):
        if self._sweeper_task is not None and not self._sweeper_task.done():
            self._sweeper_task.cancel()
            try:
                await self._sweeper_task
            except (asyncio.CancelledError, Exception):
                pass
            self._sweeper_task = None

    async def ensure_indexes(self):
        if self.is_enabled():
            await self._repository.ensure_indexes()

    async def resolve_conversation(
        self,
        user_id: str,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.is_enabled():
            resolved_id = (
                conversation_id
                if (conversation_id and conversation_id != "default")
                else str(uuid.uuid4())
            )
            return {
                "id": resolved_id,
                "user_id": user_id,
                "title": "Đoạn chat mới",
                "status": "active",
                "turn_count": 0,
                "total_tokens_est": 0,
                "anchor_exchange": [],
            }
        return await self._repository.get_or_create_conversation_by_user(
            user_id=user_id,
            conversation_id=conversation_id,
        )

    async def load_context_window(
        self,
        user_id: str,
        conversation_id: str,
    ) -> tuple[list[AssistantHistoryItem], str | None, dict[str, Any]]:
        if not self.is_enabled():
            return [], None, {}
        return await self._repository.load_context_window(
            user_id=user_id,
            conversation_id=conversation_id,
        )

    async def persist_exchange(
        self,
        user_id: str,
        user_message: str,
        assistant_reply: str,
        intent: str | None,
        sources: list[AssistantSource] | list[dict[str, Any]],
        client_message_id: str | None = None,
        actions: list[Any] | None = None,
        conversation_id: str | None = None,
        policy_blocked: bool = False,
    ) -> PersistResult:
        if not self.is_enabled():
            return PersistResult(persisted=False)

        timeout_seconds = max(settings.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS, 1) / 1000
        serialized_sources = [
            s.model_dump() if hasattr(s, "model_dump") else s for s in (sources or [])
        ]
        serialized_actions = [
            a.model_dump() if hasattr(a, "model_dump") else a for a in (actions or [])
        ]
        try:
            exchange_res = await asyncio.wait_for(
                self._repository.append_exchange(
                    user_id=user_id,
                    user_message=user_message,
                    assistant_reply=assistant_reply,
                    intent=intent,
                    sources=serialized_sources,
                    client_message_id=client_message_id,
                    actions=serialized_actions,
                    conversation_id=conversation_id,
                    policy_blocked=policy_blocked,
                ),
                timeout=timeout_seconds,
            )
            conv_key = (
                conversation_id
                if conversation_id and conversation_id != "default"
                else "__latest__"
            )
            self.invalidate_user_cache(user_id, conv_key)
            return PersistResult(
                persisted=True,
                turn_count=exchange_res.turn_count,
                locked_anchor_this_turn=exchange_res.locked_anchor_this_turn,
            )
        except Exception as exc:
            logger.warning(
                "persist_exchange failed or timed out for userId=%s: %s", user_id, exc
            )
            return PersistResult(persisted=False)

    async def get_messages_page_by_user(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
        conversation_id: str | None = None,
    ) -> AssistantHistoryPageData:
        self._ensure_enabled()

        if (before_created_at is None) != (before_id is None):
            raise ValueError(
                "before_created_at and before_id must be provided together"
            )

        resolved_page_size = self._resolve_page_size(page_size)
        conv_key = (
            conversation_id
            if (conversation_id and conversation_id != "default")
            else "__latest__"
        )

        if before_created_at is None and before_id is None:
            cached = self._get_cached_first_page(user_id, conv_key, resolved_page_size)
            if cached is not None:
                return cached

        messages, has_more = await self._repository.list_messages_by_user(
            user_id=user_id,
            page_size=resolved_page_size,
            before_created_at=before_created_at,
            before_id=before_id,
            conversation_id=conversation_id,
        )

        items = [self._to_history_message(item) for item in messages]
        next_cursor_created_at = None
        next_cursor_id = None
        if has_more and items:
            next_cursor_created_at = items[-1].created_at
            next_cursor_id = items[-1].id

        result = AssistantHistoryPageData(
            items=items,
            next_cursor_created_at=next_cursor_created_at,
            next_cursor_id=next_cursor_id,
            has_more=has_more,
        )
        if before_created_at is None and before_id is None:
            self._set_cached_first_page(user_id, conv_key, resolved_page_size, result)
        return result

    async def clear_history_by_user(self, user_id: str) -> int:
        return await self.purge_user_data(user_id, include_emotion_cache=False)

    async def purge_user_data(
        self, user_id: str, include_emotion_cache: bool = False
    ) -> int:
        if not user_id or not str(user_id).strip():
            return 0
        self._ensure_enabled()
        extractor = self.fact_extractor
        if extractor is None:
            try:
                from app.modules.chatbot.services.fact_extractor import (
                    fact_extractor_service,
                )

                extractor = fact_extractor_service
            except Exception:
                extractor = None

        if extractor is not None and hasattr(extractor, "cancel_user_tasks"):
            await extractor.cancel_user_tasks(user_id)

        deleted_count = await self._repository.purge_user_data(user_id)
        try:
            await self.profile_repo.delete_by_user(user_id)
        except Exception as exc:
            logger.warning(
                "Failed to delete user_memory_profiles for user %s: %s", user_id, exc
            )
        self.invalidate_user_cache(user_id)

        if include_emotion_cache:
            try:
                from app.modules.chatbot.services.emotion_context import (
                    emotion_context_service,
                )

                await emotion_context_service.delete_cache(user_id)
            except Exception as exc:
                logger.warning(
                    "Failed to delete emotion cache for userId=%s: %s", user_id, exc
                )

        return deleted_count

    def invalidate_user_cache(self, user_id: str, conv_key: str | None = None):
        if conv_key:
            target_keys = {
                (user_id, conv_key, k[2])
                for k in list(self._history_cache.keys())
                if k[0] == user_id and (k[1] == conv_key or k[1] == "__latest__")
            }
            for k in target_keys:
                self._history_cache.pop(k, None)
        else:
            keys = [k for k in self._history_cache.keys() if k[0] == user_id]
            for k in keys:
                self._history_cache.pop(k, None)

    async def run_sweeper_loop(self, interval_seconds: int = 3600) -> None:
        while True:
            try:
                if self.is_enabled():
                    total_swept = 0
                    while True:
                        swept = await self._repository.sweep_expired_and_tombstoned(
                            batch_size=200
                        )
                        total_swept += swept
                        if swept < 200:
                            break
                        await asyncio.sleep(0.1)
                    if total_swept > 0:
                        logger.info(
                            "Chat history sweeper removed %d conversations and their messages",
                            total_swept,
                        )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Error in chat history sweeper loop: %s", exc)
            await asyncio.sleep(interval_seconds)

    async def list_conversations_by_user(
        self, user_id: str, limit: int = 20
    ) -> list[dict[str, Any]]:
        self._ensure_enabled()
        return await self._repository.list_conversations_by_user(
            user_id=user_id, limit=limit
        )

    async def create_conversation(
        self, user_id: str, title: str | None = None
    ) -> dict[str, Any]:
        self._ensure_enabled()
        return await self._repository.create_conversation(user_id=user_id, title=title)

    async def delete_conversation(self, user_id: str, conversation_id: str) -> bool:
        self._ensure_enabled()
        deleted = await self._repository.delete_conversation_by_id(
            user_id=user_id, conversation_id=conversation_id
        )
        conv_key = (
            conversation_id
            if conversation_id and conversation_id != "default"
            else "__latest__"
        )
        self.invalidate_user_cache(user_id, conv_key)
        return deleted

    def _resolve_page_size(self, requested_page_size: int | None) -> int:
        value = requested_page_size or settings.CHATBOT_HISTORY_PAGE_SIZE_DEFAULT
        if value <= 0:
            raise ValueError("page_size must be positive")
        return min(value, settings.CHATBOT_HISTORY_PAGE_SIZE_MAX)

    def _ensure_enabled(self):
        if not self.is_enabled():
            raise RuntimeError("Chatbot DB is disabled")

    def _to_history_message(self, message: dict[str, Any]) -> AssistantHistoryMessage:
        raw_sources = message.get("sources") or []
        parsed_sources = [
            AssistantSource.model_validate(item)
            for item in raw_sources
            if isinstance(item, dict)
        ]
        return AssistantHistoryMessage(
            id=str(message["id"]),
            conversation_id=str(message["conversation_id"]),
            user_id=message["user_id"],
            role=message["role"],
            content=message["content"],
            intent=message.get("intent"),
            sources=parsed_sources,
            metadata=message.get("meta") or {},
            created_at=message["created_at"],
        )

    def _get_cached_first_page(
        self,
        user_id: str,
        conv_key: str,
        page_size: int,
    ) -> AssistantHistoryPageData | None:
        now = time.time()
        key = (user_id, conv_key, page_size)
        entry = self._history_cache.get(key)
        if not entry:
            return None
        if entry.expires_at <= now:
            self._history_cache.pop(key, None)
            return None
        return entry.value

    def _set_cached_first_page(
        self,
        user_id: str,
        conv_key: str,
        page_size: int,
        value: AssistantHistoryPageData,
    ):
        ttl = settings.CHATBOT_HISTORY_CACHE_TTL_SECONDS
        key = (user_id, conv_key, page_size)
        self._history_cache[key] = _HistoryCacheEntry(
            expires_at=time.time() + ttl,
            value=value,
        )
