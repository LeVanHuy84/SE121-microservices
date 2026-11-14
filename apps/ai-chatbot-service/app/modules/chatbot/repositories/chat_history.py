from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.core.database import get_database
from app.core.settings import settings
from app.modules.chatbot.repositories.user_memory_profile import (
    user_memory_profile_repo,
)
from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantHistoryMessage,
    AssistantHistoryPageData,
    AssistantRespondRequest,
    AssistantSource,
)
from app.utils.teencode.teencode_normalizer import teencode_normalizer

logger = logging.getLogger("uvicorn.error")

MAX_SESSIONS_PER_USER: int = 20
SESSION_TTL_SECONDS: int = 90 * 24 * 3600  # 90 days
TOKEN_BUDGET_FULL_HISTORY: int = 1500
TOKEN_CEILING_HARD: int = 2000
HISTORY_MESSAGE_CHAR_CAP: int = 1200
GAP_MARKER_TEXT: str = "[... Một số lượt trao đổi trung gian đã được lược bớt ...]"

NON_SUBSTANTIVE_INTENTS: frozenset[str] = frozenset({
    "greeting",
    "mental_health_crisis",
    "community_guard",
    "out_of_scope",
    "privacy",
    "in_domain_unknown",
    "clarify",
})

GREETING_WORDS: frozenset[str] = frozenset({
    "xin chào",
    "chào bạn",
    "chào",
    "hi",
    "hello",
    "hey",
    "alo",
})


def estimate_tokens(text: str) -> int:
    words = len((text or "").split())
    return max(1, int(words * 1.35))


def is_substantive_anchor_turn(
    user_message: str,
    intent: str | None,
    policy_blocked: bool,
) -> bool:
    if policy_blocked:
        return False
    if intent in NON_SUBSTANTIVE_INTENTS:
        return False
    normalized = teencode_normalizer.normalize(user_message or "").lower().strip(" .,!?…")
    words = normalized.split()
    if len(words) < 4:
        return False
    if normalized in GREETING_WORDS:
        return False
    return True


@dataclass
class ExchangeResult:
    user_message: dict[str, Any]
    assistant_message: dict[str, Any]
    locked_anchor_this_turn: bool = False
    turn_count: int = 0

    def __iter__(self):
        return iter((
            self.user_message,
            self.assistant_message,
            self.locked_anchor_this_turn,
            self.turn_count,
        ))

    def __getitem__(self, index: int):
        if index == 0:
            return self.user_message
        if index == 1:
            return self.assistant_message
        if index == 2:
            return self.locked_anchor_this_turn
        if index == 3:
            return self.turn_count
        raise IndexError("Index out of range")

    def __len__(self) -> int:
        return 4


@dataclass
class PersistResult:
    persisted: bool
    turn_count: int = 0
    locked_anchor_this_turn: bool = False

    def __bool__(self) -> bool:
        return self.persisted


class ChatHistoryRepository:
    def __init__(self, db: AsyncIOMotorDatabase | None = None, profile_repo: Any = None):
        self._db = db
        self._profile_repo = profile_repo
        self._indexes_ensured = False
        self._background_tasks: set[asyncio.Task] = set()

    @property
    def db(self) -> AsyncIOMotorDatabase:
        if self._db is None:
            self._db = get_database()
        return self._db

    async def ensure_indexes(self):
        if self._indexes_ensured:
            return
        conv_col = self.db["chat_conversations"]
        msg_col = self.db["chat_messages"]

        # 1. Drop legacy TTL indexes if they exist
        for col, idx_name in [
            (conv_col, "chat_conv_ttl_idx"),
            (msg_col, "chat_msg_ttl_idx"),
        ]:
            try:
                await col.drop_index(idx_name)
            except Exception:
                pass

        # 2. Create active session, sweeper, and conversation message indexes
        try:
            await conv_col.create_index(
                [("user_id", 1), ("status", 1), ("last_message_at", -1)],
                name="chat_conv_user_status_idx",
            )
        except Exception as exc:
            logger.warning("Chat index creation warning (chat_conv_user_status_idx): %s", exc)

        try:
            await conv_col.create_index(
                [("id", 1)],
                unique=True,
                name="chat_conv_id_uniq_idx",
            )
        except OperationFailure as exc:
            logger.warning("Unique index on chat_conversations.id could not be created: %s", exc)
        except Exception as exc:
            logger.warning("Chat index creation warning (chat_conv_id_uniq_idx): %s", exc)

        try:
            await conv_col.create_index(
                [("status", 1)],
                name="chat_conv_sweeper_status_idx",
            )
            await conv_col.create_index(
                [("last_message_at", 1)],
                name="chat_conv_sweeper_lma_idx",
            )
        except Exception as exc:
            logger.warning("Chat index creation warning (sweeper indexes): %s", exc)

        try:
            await msg_col.create_index(
                [("conversation_id", 1), ("created_at", -1), ("id", -1)],
                name="chat_msg_conv_idx",
            )
        except Exception as exc:
            logger.warning("Chat index creation warning (chat_msg_conv_idx): %s", exc)

        self._indexes_ensured = True

    def _active_conversation_filter(self, user_id: str, cutoff: datetime) -> dict[str, Any]:
        return {
            "user_id": user_id,
            "status": {"$ne": "tombstoned"},
            "$or": [
                {"last_message_at": {"$gte": cutoff}},
                {"last_message_at": None, "created_at": {"$gte": cutoff}},
            ],
        }

    async def _purge_conversations_by_ids(self, conv_ids: list[str]) -> None:
        if not conv_ids:
            return
        try:
            await self.db["chat_messages"].delete_many({"conversation_id": {"$in": conv_ids}})
            await self.db["chat_conversations"].delete_many({"id": {"$in": conv_ids}})
        except Exception as exc:
            logger.warning("Asynchronous purge of conversations %s failed: %s", conv_ids, exc)

    async def get_or_create_conversation_by_user(
        self,
        user_id: str,
        conversation_id: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        await self.ensure_indexes()
        conv_col = self.db["chat_conversations"]
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        # 1. If explicit conversation_id is requested, find it if active
        if conversation_id and conversation_id != "default":
            conversation = await conv_col.find_one({
                "id": conversation_id,
                "user_id": user_id,
                "status": {"$ne": "tombstoned"},
                "$or": [
                    {"last_message_at": {"$gte": cutoff}},
                    {"last_message_at": None, "created_at": {"$gte": cutoff}},
                ],
            })
            if conversation:
                return conversation

        # 2. Otherwise find the most recent active conversation
        active_filter = self._active_conversation_filter(user_id, cutoff)
        latest = await conv_col.find_one(
            active_filter,
            sort=[("last_message_at", -1), ("created_at", -1)],
        )
        if latest and not conversation_id:
            return latest

        # 3. Enforce maximum 20 active sessions per user limit (LRA soft-tombstone)
        count = await conv_col.count_documents(active_filter)
        if count >= MAX_SESSIONS_PER_USER:
            evict_count = count - MAX_SESSIONS_PER_USER + 1
            oldest_cursor = conv_col.find(active_filter).sort(
                [("last_message_at", 1), ("created_at", 1)]
            ).limit(evict_count)
            oldest_list = await oldest_cursor.to_list(length=evict_count)
            if oldest_list:
                oldest_ids = [c["id"] for c in oldest_list if "id" in c]
                await conv_col.update_many(
                    {"id": {"$in": oldest_ids}},
                    {"$set": {"status": "tombstoned", "updated_at": now}},
                )
                bg_task = asyncio.create_task(self._purge_conversations_by_ids(oldest_ids))
                self._background_tasks.add(bg_task)
                bg_task.add_done_callback(self._background_tasks.discard)

        # 4. Resolve UUID: if explicit id exists in DB (even if tombstoned/other user), mint a new one
        resolved_id = conversation_id if (conversation_id and conversation_id != "default") else None
        if resolved_id:
            existing_doc = await conv_col.find_one({"id": resolved_id})
            if existing_doc:
                resolved_id = str(uuid.uuid4())
        else:
            resolved_id = str(uuid.uuid4())

        doc = {
            "id": resolved_id,
            "user_id": user_id,
            "title": title or "Đoạn chat mới",
            "status": "active",
            "is_archived": False,
            "turn_count": 0,
            "total_tokens_est": 0,
            "anchor_exchange": [],
            "created_at": now,
            "updated_at": now,
            "last_message_at": now,
        }
        await conv_col.insert_one(doc)
        return doc

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
    ) -> ExchangeResult:
        if client_message_id:
            existing = await self.get_exchange_by_client_message_id(user_id, client_message_id)
            if existing:
                return ExchangeResult(
                    user_message=existing[0],
                    assistant_message=existing[1],
                    locked_anchor_this_turn=False,
                    turn_count=0,
                )

        conversation = await self.get_or_create_conversation_by_user(
            user_id, conversation_id=conversation_id
        )
        user_now = datetime.now(timezone.utc)
        assistant_now = user_now + timedelta(milliseconds=10)

        user_tokens = estimate_tokens(user_message)
        assistant_tokens = estimate_tokens(assistant_reply)
        turn_tokens = user_tokens + assistant_tokens

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
            "tokens_est": user_tokens,
            "created_at": user_now,
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
            "tokens_est": assistant_tokens,
            "created_at": assistant_now,
        }

        await self.db["chat_messages"].insert_many([user_msg, assistant_msg])

        update_fields: dict[str, Any] = {
            "last_message_at": assistant_now,
            "updated_at": assistant_now,
        }

        # Auto-titling: If conversation has default title, set from first user message
        current_title = conversation.get("title")
        if not current_title or current_title in ("Đoạn chat mới", "Cuộc trò chuyện mới"):
            raw_text = user_message.strip().replace("\n", " ")
            trimmed_title = (raw_text[:35] + "...") if len(raw_text) > 35 else raw_text
            if trimmed_title:
                update_fields["title"] = trimmed_title

        # Check substantive anchor locking
        existing_anchor = conversation.get("anchor_exchange")
        locked_anchor_this_turn = False
        current_turn_count = conversation.get("turn_count", 0)
        new_turn_count = current_turn_count + 1

        if not existing_anchor and is_substantive_anchor_turn(user_message, intent, policy_blocked):
            anchor_payload = [
                {
                    "id": user_msg["id"],
                    "role": "user",
                    "content": user_message[:HISTORY_MESSAGE_CHAR_CAP],
                    "created_at": user_now,
                },
                {
                    "id": assistant_msg["id"],
                    "role": "assistant",
                    "content": assistant_reply[:HISTORY_MESSAGE_CHAR_CAP],
                    "created_at": assistant_now,
                },
            ]
            # Atomic conditional update: only lock if anchor_exchange is currently missing or empty
            anchor_res = await self.db["chat_conversations"].update_one(
                {
                    "id": conversation["id"],
                    "$or": [
                        {"anchor_exchange": None},
                        {"anchor_exchange": {"$size": 0}},
                        {"anchor_exchange": {"$exists": False}},
                    ],
                },
                {
                    "$set": {
                        "anchor_exchange": anchor_payload,
                        "anchor_turn": new_turn_count,
                    }
                },
            )
            locked_anchor_this_turn = (getattr(anchor_res, "modified_count", 0) > 0)

        await self.db["chat_conversations"].update_one(
            {"id": conversation["id"]},
            {
                "$set": update_fields,
                "$inc": {
                    "turn_count": 1,
                    "total_tokens_est": turn_tokens,
                },
            },
        )

        return ExchangeResult(
            user_message=user_msg,
            assistant_message=assistant_msg,
            locked_anchor_this_turn=locked_anchor_this_turn,
            turn_count=new_turn_count,
        )

    async def load_context_window(
        self,
        user_id: str,
        conversation_id: str,
    ) -> tuple[list[AssistantHistoryItem], str | None, dict[str, Any]]:
        await self.ensure_indexes()
        conv_col = self.db["chat_conversations"]
        msg_col = self.db["chat_messages"]
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        conversation = await conv_col.find_one({
            "id": conversation_id,
            "user_id": user_id,
            "status": {"$ne": "tombstoned"},
            "$or": [
                {"last_message_at": {"$gte": cutoff}},
                {"last_message_at": None, "created_at": {"$gte": cutoff}},
            ],
        })
        if not conversation:
            return [], None, {}

        # Pre-v2 migration backfill: if turn_count is missing, backfill once from chat_messages
        if conversation.get("turn_count") is None:
            all_msgs_cursor = msg_col.find(
                {"conversation_id": conversation_id}
            ).sort([("created_at", 1), ("id", 1)])
            all_msgs = await all_msgs_cursor.to_list(length=1000)

            user_msgs = [m for m in all_msgs if m.get("role") == "user"]
            backfill_turn_count = len(user_msgs)
            backfill_tokens = sum(estimate_tokens(m.get("content", "")) for m in all_msgs)

            backfill_anchor: list[dict[str, Any]] = []
            backfill_anchor_turn: int | None = None

            # Find first substantive exchange
            for idx, u_msg in enumerate(user_msgs):
                u_intent = u_msg.get("intent")
                u_blocked = bool((u_msg.get("meta") or {}).get("policyBlocked", False))
                if is_substantive_anchor_turn(u_msg.get("content", ""), u_intent, u_blocked):
                    # Match subsequent assistant message
                    u_created = u_msg.get("created_at")
                    a_msg = next(
                        (
                            m
                            for m in all_msgs
                            if m.get("role") == "assistant"
                            and m.get("created_at") is not None
                            and u_created is not None
                            and m.get("created_at") >= u_created
                        ),
                        None,
                    )
                    if a_msg:
                        backfill_anchor = [
                            {
                                "id": u_msg.get("id"),
                                "role": "user",
                                "content": (u_msg.get("content") or "")[:HISTORY_MESSAGE_CHAR_CAP],
                                "created_at": u_msg.get("created_at"),
                            },
                            {
                                "id": a_msg.get("id"),
                                "role": "assistant",
                                "content": (a_msg.get("content") or "")[:HISTORY_MESSAGE_CHAR_CAP],
                                "created_at": a_msg.get("created_at"),
                            },
                        ]
                        backfill_anchor_turn = idx + 1
                        break

            backfill_set: dict[str, Any] = {
                "turn_count": backfill_turn_count,
                "total_tokens_est": backfill_tokens,
                "anchor_exchange": backfill_anchor,
                "status": conversation.get("status", "active"),
            }
            if backfill_anchor_turn is not None:
                backfill_set["anchor_turn"] = backfill_anchor_turn

            await conv_col.update_one({"id": conversation_id}, {"$set": backfill_set})
            conversation.update(backfill_set)

        total_tokens_est = conversation.get("total_tokens_est", 0)

        # Step 1: Full History Within Token Budget (<= 1,500 tokens)
        if total_tokens_est <= TOKEN_BUDGET_FULL_HISTORY:
            cursor = msg_col.find(
                {"conversation_id": conversation_id}
            ).sort([("created_at", -1), ("id", -1)]).limit(40)
            rows = await cursor.to_list(length=40)
            rows.reverse()
            history_items = [
                AssistantHistoryItem(role=r["role"], content=r["content"])
                for r in rows
            ]
            last_intent = None
            for r in reversed(rows):
                if r.get("role") == "assistant" and r.get("intent"):
                    last_intent = r["intent"]
                    break
            return history_items, last_intent, conversation

        # Step 2: Substantive Anchor + Recent 3 Turns (> 1,500 tokens)
        raw_anchor = conversation.get("anchor_exchange") or []
        anchor_ids = {m["id"] for m in raw_anchor if "id" in m}
        anchor_latest_time = max(
            (m["created_at"] for m in raw_anchor if "created_at" in m and m["created_at"]),
            default=None,
        )
        anchor_items = [
            AssistantHistoryItem(role=m["role"], content=m["content"])
            for m in raw_anchor
        ]

        cursor = msg_col.find(
            {"conversation_id": conversation_id}
        ).sort([("created_at", -1), ("id", -1)]).limit(6)
        recent_rows = await cursor.to_list(length=6)
        recent_rows.reverse()

        # Deduplicate: drop any message already in anchor_exchange or created before/at anchor
        filtered_recent = [
            r for r in recent_rows
            if r.get("id") not in anchor_ids
            and (
                anchor_latest_time is None
                or r.get("created_at") is None
                or r.get("created_at", datetime.min.replace(tzinfo=timezone.utc)) > anchor_latest_time
            )
        ]
        recent_items = [
            AssistantHistoryItem(role=r["role"], content=r["content"])
            for r in filtered_recent
        ]

        # Enforce hard ceiling of 2,000 tokens
        def _calc_total_tokens(items: list[AssistantHistoryItem]) -> int:
            return sum(estimate_tokens(i.content[:HISTORY_MESSAGE_CHAR_CAP]) for i in items)

        while _calc_total_tokens(anchor_items + recent_items) > TOKEN_CEILING_HARD and len(recent_items) > 2:
            if len(recent_items) >= 4:
                recent_items = recent_items[2:]
            else:
                recent_items = recent_items[1:]

        # Step 3: Gap Marker Injection
        turn_count = conversation.get("turn_count", 0)
        anchor_turn = conversation.get("anchor_turn", 1)
        recent_turn_count = len(recent_items) // 2

        gap_needed = (
            bool(anchor_items)
            and bool(recent_items)
            and (turn_count - recent_turn_count > anchor_turn)
        )

        history_items = []
        if anchor_items:
            history_items.extend(anchor_items)
        if gap_needed:
            history_items.append(
                AssistantHistoryItem(role="system", content=GAP_MARKER_TEXT)
            )
        if recent_items:
            history_items.extend(recent_items)

        last_intent = None
        for r in reversed(recent_rows):
            if r.get("role") == "assistant" and r.get("intent"):
                last_intent = r["intent"]
                break

        return history_items, last_intent, conversation

    async def list_conversations_by_user(
        self,
        user_id: str,
        limit: int = MAX_SESSIONS_PER_USER,
    ) -> list[dict[str, Any]]:
        await self.ensure_indexes()
        conv_col = self.db["chat_conversations"]
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        cursor = conv_col.find(
            self._active_conversation_filter(user_id, cutoff)
        ).sort([("last_message_at", -1), ("created_at", -1)]).limit(limit)

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
            "client_message_id": client_message_id,
        })
        if not user_msg:
            return None

        assistant_msg = await self.db["chat_messages"].find_one({
            "conversation_id": user_msg["conversation_id"],
            "role": "assistant",
            "created_at": {"$gte": user_msg["created_at"]},
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
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)

        if conversation_id and conversation_id != "default":
            conversation = await self.db["chat_conversations"].find_one({
                "id": conversation_id,
                "user_id": user_id,
                "status": {"$ne": "tombstoned"},
                "$or": [
                    {"last_message_at": {"$gte": cutoff}},
                    {"last_message_at": None, "created_at": {"$gte": cutoff}},
                ],
            })
        else:
            conversation = await self.db["chat_conversations"].find_one(
                self._active_conversation_filter(user_id, cutoff),
                sort=[("last_message_at", -1), ("created_at", -1)],
            )
        if not conversation:
            return [], False

        query: dict[str, Any] = {"conversation_id": conversation["id"]}
        if before_created_at and before_id:
            query["$or"] = [
                {"created_at": {"$lt": before_created_at}},
                {
                    "created_at": before_created_at,
                    "id": {"$lt": before_id},
                },
            ]

        cursor = self.db["chat_messages"].find(query).sort([("created_at", -1), ("id", -1)]).limit(page_size + 1)
        rows = await cursor.to_list(length=page_size + 1)

        has_more = len(rows) > page_size
        if has_more:
            rows = rows[:page_size]

        return rows, has_more

    async def list_recent_user_messages(
        self,
        conversation_id: str,
        limit: int = 5,
        user_id: str | None = None,
    ) -> list[str]:
        query: dict[str, Any] = {"conversation_id": conversation_id, "role": "user"}
        if user_id:
            query["user_id"] = user_id
        cursor = self.db["chat_messages"].find(query).sort([("created_at", -1), ("id", -1)]).limit(limit)
        docs = await cursor.to_list(length=limit)
        return [str(d.get("content", "")) for d in docs if d.get("content")]

    async def is_conversation_active(
        self,
        user_id: str,
        conversation_id: str,
    ) -> bool:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)
        doc = await self.db["chat_conversations"].find_one({
            "id": conversation_id,
            "user_id": user_id,
            "status": {"$ne": "tombstoned"},
            "$or": [
                {"last_message_at": {"$gte": cutoff}},
                {"last_message_at": None, "created_at": {"$gte": cutoff}},
            ],
        })
        return doc is not None

    async def sweep_expired_and_tombstoned(self, batch_size: int = 200) -> int:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)
        conv_col = self.db["chat_conversations"]

        sweep_query = {
            "$or": [
                {"status": "tombstoned"},
                {"last_message_at": {"$lt": cutoff}},
                {"last_message_at": None, "created_at": {"$lt": cutoff}},
            ],
        }

        cursor = conv_col.find(sweep_query).limit(batch_size)
        convs = await cursor.to_list(length=batch_size)
        if not convs:
            return 0

        batch_ids = [c["id"] for c in convs if "id" in c]
        if batch_ids:
            await self.db["chat_messages"].delete_many({"conversation_id": {"$in": batch_ids}})
            del_res = await conv_col.delete_many({"id": {"$in": batch_ids}})
            return del_res.deleted_count
        return 0

    async def purge_user_data(self, user_id: str) -> int:
        if not user_id or not str(user_id).strip():
            return 0
        conv_cursor = self.db["chat_conversations"].find({"user_id": user_id})
        convs = await conv_cursor.to_list(length=1000)
        conv_ids = [c["id"] for c in convs if "id" in c]

        delete_filter: dict[str, Any] = {"user_id": user_id}
        if conv_ids:
            delete_filter = {"$or": [{"user_id": user_id}, {"conversation_id": {"$in": conv_ids}}]}

        res = await self.db["chat_messages"].delete_many(delete_filter)
        await self.db["chat_conversations"].delete_many({"user_id": user_id})
        try:
            await self.db["user_memory_profiles"].delete_one({"_id": user_id})
        except Exception:
            pass
        target_profile_repo = self._profile_repo or user_memory_profile_repo
        await target_profile_repo.delete_by_user(user_id)
        return res.deleted_count

    async def clear_history_by_user(self, user_id: str) -> int:
        return await self.purge_user_data(user_id)


@dataclass
class _HistoryCacheEntry:
    expires_at: float
    value: AssistantHistoryPageData


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
        if self._repository is not None and getattr(self._repository, "_db", None) is not None:
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
            s.model_dump() if hasattr(s, "model_dump") else s
            for s in (sources or [])
        ]
        serialized_actions = [
            a.model_dump() if hasattr(a, "model_dump") else a
            for a in (actions or [])
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
            conv_key = conversation_id if conversation_id and conversation_id != "default" else "__latest__"
            self.invalidate_user_cache(user_id, conv_key)
            return PersistResult(
                persisted=True,
                turn_count=exchange_res.turn_count,
                locked_anchor_this_turn=exchange_res.locked_anchor_this_turn,
            )
        except Exception as exc:
            logger.warning("persist_exchange failed or timed out for userId=%s: %s", user_id, exc)
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
            raise ValueError("before_created_at and before_id must be provided together")

        resolved_page_size = self._resolve_page_size(page_size)
        conv_key = conversation_id if (conversation_id and conversation_id != "default") else "__latest__"

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

    async def purge_user_data(self, user_id: str, include_emotion_cache: bool = False) -> int:
        if not user_id or not str(user_id).strip():
            return 0
        self._ensure_enabled()
        extractor = self.fact_extractor
        if extractor is None:
            try:
                from app.modules.chatbot.services.fact_extractor import fact_extractor_service
                extractor = fact_extractor_service
            except Exception:
                extractor = None

        if extractor is not None and hasattr(extractor, "cancel_user_tasks"):
            await extractor.cancel_user_tasks(user_id)

        deleted_count = await self._repository.purge_user_data(user_id)
        try:
            await self.profile_repo.delete_by_user(user_id)
        except Exception as exc:
            logger.warning("Failed to delete user_memory_profiles for user %s: %s", user_id, exc)
        self.invalidate_user_cache(user_id)

        if include_emotion_cache:
            try:
                from app.modules.chatbot.services.emotion_context import emotion_context_service
                await emotion_context_service.delete_cache(user_id)
            except Exception as exc:
                logger.warning("Failed to delete emotion cache for userId=%s: %s", user_id, exc)

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
                        swept = await self._repository.sweep_expired_and_tombstoned(batch_size=200)
                        total_swept += swept
                        if swept < 200:
                            break
                        await asyncio.sleep(0.1)
                    if total_swept > 0:
                        logger.info("Chat history sweeper removed %d conversations and their messages", total_swept)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("Error in chat history sweeper loop: %s", exc)
            await asyncio.sleep(interval_seconds)

    async def list_conversations_by_user(self, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        self._ensure_enabled()
        return await self._repository.list_conversations_by_user(user_id=user_id, limit=limit)

    async def create_conversation(self, user_id: str, title: str | None = None) -> dict[str, Any]:
        self._ensure_enabled()
        return await self._repository.create_conversation(user_id=user_id, title=title)

    async def delete_conversation(self, user_id: str, conversation_id: str) -> bool:
        self._ensure_enabled()
        deleted = await self._repository.delete_conversation_by_id(user_id=user_id, conversation_id=conversation_id)
        conv_key = conversation_id if conversation_id and conversation_id != "default" else "__latest__"
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


class ClearHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(self, user_id: str) -> int:
        return await self.store.purge_user_data(user_id, include_emotion_cache=False)


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
    ) -> PersistResult:
        if not self.store.is_enabled():
            return PersistResult(persisted=False)

        return await self.store.persist_exchange(
            user_id=request.userId,
            user_message=request.message,
            assistant_reply=assistant_reply,
            intent=intent,
            sources=sources,
            client_message_id=request.clientMessageId or getattr(request, "requestId", None),
            actions=actions,
            conversation_id=request.conversationId,
            policy_blocked=policy_blocked,
        )


history_store = HistoryStore()
