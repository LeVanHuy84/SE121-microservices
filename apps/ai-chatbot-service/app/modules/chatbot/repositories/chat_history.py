from __future__ import annotations

import uuid
import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from motor.motor_asyncio import AsyncIOMotorDatabase
from app.core.database import get_database
from app.core.settings import settings
from app.modules.chatbot.schemas import (
    AssistantHistoryMessage,
    AssistantHistoryPageData,
    AssistantSource,
    AssistantRespondRequest,
)
from app.modules.chatbot.services.memory import SessionMemory, session_memory


class ChatHistoryRepository:
    def __init__(self, db: AsyncIOMotorDatabase | None = None):
        self._db = db

    @property
    def db(self) -> AsyncIOMotorDatabase:
        if self._db is None:
            self._db = get_database()
        return self._db

    async def get_or_create_conversation_by_user(self, user_id: str) -> dict[str, Any]:
        conv_col = self.db["chat_conversations"]
        conversation = await conv_col.find_one({"user_id": user_id})
        if conversation:
            return conversation

        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "title": None,
            "is_archived": False,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "last_message_at": None
        }
        await conv_col.insert_one(doc)
        return doc

    async def append_message(
        self,
        user_id: str,
        role: str,
        content: str,
        intent: str | None = None,
        sources: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        conversation = await self.get_or_create_conversation_by_user(user_id)
        now = datetime.now(timezone.utc)
        
        message_doc = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation["id"],
            "user_id": user_id,
            "role": role,
            "client_message_id": None,
            "content": content,
            "intent": intent,
            "sources": sources or [],
            "meta": metadata or {},
            "created_at": now
        }
        
        await self.db["chat_messages"].insert_one(message_doc)
        await self.db["chat_conversations"].update_one(
            {"id": conversation["id"]},
            {"$set": {"last_message_at": now, "updated_at": now}}
        )
        return message_doc

    async def append_exchange(
        self,
        user_id: str,
        user_message: str,
        assistant_reply: str,
        intent: str | None = None,
        sources: list[dict[str, Any]] | None = None,
        client_message_id: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if client_message_id:
            existing = await self.get_exchange_by_client_message_id(user_id, client_message_id)
            if existing:
                return existing

        conversation = await self.get_or_create_conversation_by_user(user_id)
        from datetime import timedelta
        user_now = datetime.now(timezone.utc)
        assistant_now = user_now + timedelta(milliseconds=10)
        
        user_msg = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation["id"],
            "user_id": user_id,
            "role": "user",
            "client_message_id": client_message_id,
            "content": user_message,
            "intent": None,
            "sources": [],
            "meta": {"message_kind": "user"},
            "created_at": user_now
        }
        
        assistant_msg = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation["id"],
            "user_id": user_id,
            "role": "assistant",
            "client_message_id": None,
            "content": assistant_reply,
            "intent": intent,
            "sources": sources or [],
            "meta": {"message_kind": "assistant"},
            "created_at": assistant_now
        }
        
        await self.db["chat_messages"].insert_many([user_msg, assistant_msg])
        await self.db["chat_conversations"].update_one(
            {"id": conversation["id"]},
            {"$set": {"last_message_at": assistant_now, "updated_at": assistant_now}}
        )
        return user_msg, assistant_msg

    async def get_exchange_by_client_message_id(
        self,
        user_id: str,
        client_message_id: str,
    ) -> tuple[dict[str, Any], dict[str, Any]] | None:
        user_msg = await self.db["chat_messages"].find_one({
            "user_id": user_id,
            "role": "user",
            "client_message_id": client_message_id
        })
        if not user_msg:
            return None

        assistant_msg = await self.db["chat_messages"].find_one({
            "conversation_id": user_msg["conversation_id"],
            "role": "assistant",
            "created_at": {"$gte": user_msg["created_at"]}
        }, sort=[("created_at", 1)])
        
        if not assistant_msg:
            return None
            
        return user_msg, assistant_msg

    async def list_messages_by_user(
        self,
        user_id: str,
        page_size: int,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        conversation = await self.db["chat_conversations"].find_one({"user_id": user_id})
        if not conversation:
            return [], False

        query: dict[str, Any] = {"conversation_id": conversation["id"]}
        if before_created_at and before_id:
            query["$or"] = [
                {"created_at": {"$lt": before_created_at}},
                {
                    "created_at": before_created_at,
                    "id": {"$lt": before_id}
                }
            ]

        cursor = self.db["chat_messages"].find(query).sort([("created_at", -1), ("id", -1)]).limit(page_size + 1)
        rows = await cursor.to_list(length=page_size + 1)

        has_more = len(rows) > page_size
        if has_more:
            rows = rows[:page_size]

        return rows, has_more

    async def clear_history_by_user(self, user_id: str) -> int:
        conversation = await self.db["chat_conversations"].find_one({"user_id": user_id})
        if not conversation:
            return 0

        res = await self.db["chat_messages"].delete_many({"conversation_id": conversation["id"]})
        await self.db["chat_conversations"].update_one(
            {"id": conversation["id"]},
            {"$set": {"last_message_at": None, "updated_at": datetime.now(timezone.utc)}}
        )
        return res.deleted_count




logger = logging.getLogger("uvicorn.error")


@dataclass
class _HistoryCacheEntry:
    expires_at: float
    value: AssistantHistoryPageData


class HistoryStore:
    def __init__(self, repository: ChatHistoryRepository | None = None):
        self._repository = repository or ChatHistoryRepository()
        self._write_queue: asyncio.Queue[dict[str, Any]] | None = None
        self._workers: list[asyncio.Task[None]] = []
        self._history_cache: dict[tuple[str, int], _HistoryCacheEntry] = {}

    def is_enabled(self) -> bool:
        return True

    async def start(self):
        if not self.is_enabled():
            return
        if self._write_queue is None:
            self._write_queue = asyncio.Queue(maxsize=settings.CHATBOT_HISTORY_QUEUE_SIZE)
        if self._workers:
            return
        for index in range(settings.CHATBOT_HISTORY_WRITE_WORKERS):
            task = asyncio.create_task(self._worker_loop(index))
            self._workers.append(task)

    async def stop(self):
        for worker in self._workers:
            worker.cancel()
        if self._workers:
            await asyncio.gather(*self._workers, return_exceptions=True)
        self._workers.clear()

    async def enqueue_exchange(
        self,
        user_id: str,
        user_message: str,
        assistant_reply: str,
        intent: str | None,
        sources: list[AssistantSource],
        client_message_id: str | None = None,
    ) -> bool:
        if not self.is_enabled():
            return False
        if self._write_queue is None:
            await self.start()
        if self._write_queue is None:
            return False

        payload = {
            "user_id": user_id,
            "user_message": user_message,
            "assistant_reply": assistant_reply,
            "intent": intent,
            "sources": [item.model_dump() for item in sources],
            "client_message_id": client_message_id,
        }
        try:
            self._write_queue.put_nowait(payload)
            return True
        except asyncio.QueueFull:
            logger.warning("History write queue full; dropping persist event userId=%s", user_id)
            return False

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
        if before_created_at is None and before_id is None:
            cached = self._get_cached_first_page(user_id, resolved_page_size)
            if cached is not None:
                return cached

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

        result = AssistantHistoryPageData(
            items=items,
            next_cursor_created_at=next_cursor_created_at,
            next_cursor_id=next_cursor_id,
            has_more=has_more,
        )
        if before_created_at is None and before_id is None:
            self._set_cached_first_page(user_id, resolved_page_size, result)
        return result

    async def clear_history_by_user(self, user_id: str) -> int:
        self._ensure_enabled()
        deleted_count = await self._repository.clear_history_by_user(user_id)
        self.invalidate_user_cache(user_id)
        return deleted_count

    def invalidate_user_cache(self, user_id: str):
        keys = [key for key in self._history_cache.keys() if key[0] == user_id]
        for key in keys:
            self._history_cache.pop(key, None)

    async def _worker_loop(self, worker_index: int):
        del worker_index
        while True:
            payload = await self._write_queue.get()
            try:
                await self._repository.append_exchange(
                    user_id=payload["user_id"],
                    user_message=payload["user_message"],
                    assistant_reply=payload["assistant_reply"],
                    intent=payload["intent"],
                    sources=payload["sources"],
                    client_message_id=payload["client_message_id"],
                )
                self.invalidate_user_cache(payload["user_id"])
            except Exception:
                logger.exception(
                    "Assistant history persistence failed: userId=%s",
                    payload.get("user_id"),
                )
            finally:
                self._write_queue.task_done()

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

    def _get_cached_first_page(self, user_id: str, page_size: int) -> AssistantHistoryPageData | None:
        now = time.time()
        key = (user_id, page_size)
        entry = self._history_cache.get(key)
        if not entry:
            return None
        if entry.expires_at <= now:
            self._history_cache.pop(key, None)
            return None
        return entry.value

    def _set_cached_first_page(self, user_id: str, page_size: int, value: AssistantHistoryPageData):
        ttl = settings.CHATBOT_HISTORY_CACHE_TTL_SECONDS
        key = (user_id, page_size)
        self._history_cache[key] = _HistoryCacheEntry(
            expires_at=time.time() + ttl,
            value=value,
        )






class ClearHistoryCommand:
    def __init__(
        self,
        store: HistoryStore | None = None,
        memory: SessionMemory | None = None,
    ):
        self.store = store or history_store
        self.memory = memory or session_memory

    async def execute(self, user_id: str) -> int:
        deleted_count = await self.store.clear_history_by_user(user_id)
        self.memory.clear_session(f"{user_id}:default")
        return deleted_count



class GetHistoryQuery:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> AssistantHistoryPageData:
        return await self.store.get_messages_page_by_user(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
        )



class PersistHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ) -> bool:
        if not self.store.is_enabled():
            return False

        return await self.store.enqueue_exchange(
            user_id=request.userId,
            user_message=request.message,
            assistant_reply=assistant_reply,
            intent=intent,
            sources=sources,
            client_message_id=request.clientMessageId,
        )

history_store = HistoryStore()
