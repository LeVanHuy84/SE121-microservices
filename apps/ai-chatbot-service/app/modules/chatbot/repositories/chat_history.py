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


MAX_SESSIONS_PER_USER = 20
SESSION_TTL_SECONDS = 90 * 24 * 3600  # 90 days


class ChatHistoryRepository:
    def __init__(self, db: AsyncIOMotorDatabase | None = None):
        self._db = db
        self._indexes_ensured = False

    @property
    def db(self) -> AsyncIOMotorDatabase:
        if self._db is None:
            self._db = get_database()
        return self._db

    async def ensure_indexes(self):
        if self._indexes_ensured:
            return
        try:
            await self.db["chat_conversations"].create_index(
                [("last_message_at", 1)],
                expireAfterSeconds=SESSION_TTL_SECONDS,
                name="chat_conv_ttl_idx"
            )
            await self.db["chat_conversations"].create_index(
                [("user_id", 1), ("last_message_at", -1)],
                name="chat_conv_user_idx"
            )
            await self.db["chat_messages"].create_index(
                [("conversation_id", 1), ("created_at", -1), ("id", -1)],
                name="chat_msg_conv_idx"
            )
            await self.db["chat_messages"].create_index(
                [("created_at", 1)],
                expireAfterSeconds=SESSION_TTL_SECONDS,
                name="chat_msg_ttl_idx"
            )
            self._indexes_ensured = True
        except Exception as exc:
            logging.getLogger("uvicorn.error").warning("Chat index creation warning: %s", exc)

    async def get_or_create_conversation_by_user(
        self,
        user_id: str,
        conversation_id: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        await self.ensure_indexes()
        conv_col = self.db["chat_conversations"]
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        # 1. If explicit conversation_id is requested, find it
        if conversation_id and conversation_id != "default":
            conversation = await conv_col.find_one({"id": conversation_id, "user_id": user_id})
            if conversation:
                return conversation

        # 2. Otherwise find the most recent active (non-expired) conversation
        latest = await conv_col.find_one(
            {
                "user_id": user_id,
                "$or": [
                    {"last_message_at": {"$gte": cutoff}},
                    {"last_message_at": None, "created_at": {"$gte": cutoff}},
                ],
            },
            sort=[("last_message_at", -1), ("created_at", -1)],
        )
        if latest and not conversation_id:
            return latest

        # 3. Enforce maximum 20 sessions per user limit (evict oldest if >= 20)
        count = await conv_col.count_documents({"user_id": user_id})
        if count >= MAX_SESSIONS_PER_USER:
            evict_count = count - MAX_SESSIONS_PER_USER + 1
            oldest_cursor = conv_col.find({"user_id": user_id}).sort(
                [("last_message_at", 1), ("created_at", 1)]
            ).limit(evict_count)
            oldest_list = await oldest_cursor.to_list(length=evict_count)
            if oldest_list:
                oldest_ids = [c["id"] for c in oldest_list]
                await conv_col.delete_many({"id": {"$in": oldest_ids}})
                await self.db["chat_messages"].delete_many({"conversation_id": {"$in": oldest_ids}})

        doc = {
            "id": conversation_id if (conversation_id and conversation_id != "default") else str(uuid.uuid4()),
            "user_id": user_id,
            "title": title or "Đoạn chat mới",
            "is_archived": False,
            "created_at": now,
            "updated_at": now,
            "last_message_at": now,
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
        actions: list[dict[str, Any]] | None = None,
        conversation_id: str | None = None,
        policy_blocked: bool = False,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if client_message_id:
            existing = await self.get_exchange_by_client_message_id(user_id, client_message_id)
            if existing:
                return existing

        conversation = await self.get_or_create_conversation_by_user(
            user_id, conversation_id=conversation_id
        )
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
        
        assistant_meta: dict[str, Any] = {"message_kind": "assistant"}
        if actions:
            assistant_meta["actions"] = actions
        if policy_blocked:
            assistant_meta["policyBlocked"] = True

        assistant_msg = {
            "id": str(uuid.uuid4()),
            "conversation_id": conversation["id"],
            "user_id": user_id,
            "role": "assistant",
            "client_message_id": None,
            "content": assistant_reply,
            "intent": intent,
            "sources": sources or [],
            "meta": assistant_meta,
            "created_at": assistant_now
        }
        
        await self.db["chat_messages"].insert_many([user_msg, assistant_msg])

        # Auto-titling: If conversation has default title, set from first user message
        update_fields: dict[str, Any] = {
            "last_message_at": assistant_now,
            "updated_at": assistant_now,
        }
        current_title = conversation.get("title")
        if not current_title or current_title in ("Đoạn chat mới", "Cuộc trò chuyện mới"):
            raw_text = user_message.strip().replace("\n", " ")
            trimmed_title = (raw_text[:35] + "...") if len(raw_text) > 35 else raw_text
            if trimmed_title:
                update_fields["title"] = trimmed_title

        await self.db["chat_conversations"].update_one(
            {"id": conversation["id"]},
            {"$set": update_fields}
        )
        return user_msg, assistant_msg

    async def list_conversations_by_user(
        self,
        user_id: str,
        limit: int = MAX_SESSIONS_PER_USER,
    ) -> list[dict[str, Any]]:
        await self.ensure_indexes()
        conv_col = self.db["chat_conversations"]
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        cursor = conv_col.find({
            "user_id": user_id,
            "$or": [
                {"last_message_at": {"$gte": cutoff}},
                {"last_message_at": None, "created_at": {"$gte": cutoff}},
            ],
        }).sort([("last_message_at", -1), ("created_at", -1)]).limit(limit)

        return await cursor.to_list(length=limit)

    async def create_conversation(
        self,
        user_id: str,
        title: str | None = None,
    ) -> dict[str, Any]:
        return await self.get_or_create_conversation_by_user(
            user_id=user_id,
            conversation_id=str(uuid.uuid4()),
            title=title or "Đoạn chat mới",
        )

    async def delete_conversation_by_id(
        self,
        user_id: str,
        conversation_id: str,
    ) -> bool:
        conv_col = self.db["chat_conversations"]
        res = await conv_col.delete_one({"id": conversation_id, "user_id": user_id})
        if res.deleted_count > 0:
            await self.db["chat_messages"].delete_many({"conversation_id": conversation_id})
            return True
        return False

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
        conversation_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        if conversation_id and conversation_id != "default":
            conversation = await self.db["chat_conversations"].find_one({"id": conversation_id, "user_id": user_id})
        else:
            conversation = await self.get_or_create_conversation_by_user(user_id)
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
        conv_cursor = self.db["chat_conversations"].find({"user_id": user_id})
        convs = await conv_cursor.to_list(length=100)
        conv_ids = [c["id"] for c in convs if "id" in c]

        delete_filter: dict[str, Any] = {"user_id": user_id}
        if conv_ids:
            delete_filter = {"$or": [{"user_id": user_id}, {"conversation_id": {"$in": conv_ids}}]}

        res = await self.db["chat_messages"].delete_many(delete_filter)
        await self.db["chat_conversations"].delete_many({"user_id": user_id})
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
        return settings.CHATBOT_DB_ENABLED

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
        actions: list[Any] | None = None,
        conversation_id: str | None = None,
        policy_blocked: bool = False,
    ) -> bool:
        if not self.is_enabled():
            return False
        if self._write_queue is None:
            await self.start()
        if self._write_queue is None:
            return False

        serialized_actions = [
            item.model_dump() if hasattr(item, "model_dump") else item
            for item in (actions or [])
        ]
        payload = {
            "user_id": user_id,
            "user_message": user_message,
            "assistant_reply": assistant_reply,
            "intent": intent,
            "sources": [item.model_dump() for item in sources],
            "client_message_id": client_message_id,
            "actions": serialized_actions,
            "conversation_id": conversation_id,
            "policy_blocked": policy_blocked,
        }
        try:
            await asyncio.wait_for(self._write_queue.put(payload), timeout=1.5)
            return True
        except (asyncio.QueueFull, TimeoutError, asyncio.TimeoutError):
            logger.warning("History write queue congested; falling back to direct DB write for userId=%s", user_id)
            try:
                await asyncio.wait_for(
                    self._repository.append_exchange(
                        user_id=user_id,
                        user_message=user_message,
                        assistant_reply=assistant_reply,
                        intent=intent,
                        sources=payload["sources"],
                        client_message_id=client_message_id,
                        actions=serialized_actions,
                        conversation_id=conversation_id,
                        policy_blocked=policy_blocked,
                    ),
                    timeout=2.0,
                )
                self.invalidate_user_cache(user_id)
                return True
            except Exception as exc:
                logger.error("Direct history persist fallback failed for userId=%s: %s", user_id, exc)
                return False

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
            raise ValueError("before_created_at and before_id must be provided together")

        resolved_page_size = self._resolve_page_size(page_size)
        if before_created_at is None and before_id is None and not conversation_id:
            cached = self._get_cached_first_page(user_id, resolved_page_size)
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
                    actions=payload.get("actions"),
                    conversation_id=payload.get("conversation_id"),
                    policy_blocked=payload.get("policy_blocked", False),
                )
                self.invalidate_user_cache(payload["user_id"])
            except Exception:
                logger.exception(
                    "Assistant history persistence failed: userId=%s",
                    payload.get("user_id"),
                )
            finally:
                self._write_queue.task_done()

    async def list_conversations_by_user(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        self._ensure_enabled()
        return await self._repository.list_conversations_by_user(user_id=user_id, limit=limit)

    async def create_conversation(self, user_id: str, title: str | None = None) -> dict[str, Any]:
        self._ensure_enabled()
        return await self._repository.create_conversation(user_id=user_id, title=title)

    async def delete_conversation(self, user_id: str, conversation_id: str) -> bool:
        self._ensure_enabled()
        deleted = await self._repository.delete_conversation_by_id(user_id=user_id, conversation_id=conversation_id)
        self.invalidate_user_cache(user_id)
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
        await self.memory.clear_session(f"{user_id}:default")
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
        self.store = store or history_store

    async def execute(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        return await self.store.list_conversations_by_user(user_id=user_id, limit=limit)


class CreateConversationCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(self, user_id: str, title: str | None = None) -> dict[str, Any]:
        return await self.store.create_conversation(user_id=user_id, title=title)


class DeleteConversationCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(self, user_id: str, conversation_id: str) -> bool:
        return await self.store.delete_conversation(user_id=user_id, conversation_id=conversation_id)


class PersistHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
        actions: list[Any] | None = None,
        policy_blocked: bool = False,
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
            actions=actions,
            conversation_id=request.conversationId,
            policy_blocked=policy_blocked,
        )

history_store = HistoryStore()
