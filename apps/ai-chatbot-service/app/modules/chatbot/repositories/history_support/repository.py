from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo.errors import OperationFailure

from app.core.database import get_database
from app.modules.chatbot.repositories.history_support.helpers import (
    estimate_tokens,
    is_substantive_anchor_turn,
)
from app.modules.chatbot.repositories.history_support.types import (
    ExchangeResult,
    GAP_MARKER_TEXT,
    HISTORY_MESSAGE_CHAR_CAP,
    MAX_SESSIONS_PER_USER,
    SESSION_TTL_SECONDS,
    TOKEN_BUDGET_FULL_HISTORY,
    TOKEN_CEILING_HARD,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    user_memory_profile_repo,
)
from app.modules.chatbot.schemas import AssistantHistoryItem

logger = logging.getLogger("uvicorn.error")


class ChatHistoryRepository:
    def __init__(
        self, db: AsyncIOMotorDatabase | None = None, profile_repo: Any = None
    ):
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
            logger.warning(
                "Chat index creation warning (chat_conv_user_status_idx): %s", exc
            )

        try:
            await conv_col.create_index(
                [("id", 1)],
                unique=True,
                name="chat_conv_id_uniq_idx",
            )
        except OperationFailure as exc:
            logger.warning(
                "Unique index on chat_conversations.id could not be created: %s", exc
            )
        except Exception as exc:
            logger.warning(
                "Chat index creation warning (chat_conv_id_uniq_idx): %s", exc
            )

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

    def _active_conversation_filter(
        self, user_id: str, cutoff: datetime
    ) -> dict[str, Any]:
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
            await self.db["chat_messages"].delete_many(
                {"conversation_id": {"$in": conv_ids}}
            )
            await self.db["chat_conversations"].delete_many({"id": {"$in": conv_ids}})
        except Exception as exc:
            logger.warning(
                "Asynchronous purge of conversations %s failed: %s", conv_ids, exc
            )

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
            conversation = await conv_col.find_one(
                {
                    "id": conversation_id,
                    "user_id": user_id,
                    "status": {"$ne": "tombstoned"},
                    "$or": [
                        {"last_message_at": {"$gte": cutoff}},
                        {"last_message_at": None, "created_at": {"$gte": cutoff}},
                    ],
                }
            )
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
            oldest_cursor = (
                conv_col.find(active_filter)
                .sort([("last_message_at", 1), ("created_at", 1)])
                .limit(evict_count)
            )
            oldest_list = await oldest_cursor.to_list(length=evict_count)
            if oldest_list:
                oldest_ids = [c["id"] for c in oldest_list if "id" in c]
                await conv_col.update_many(
                    {"id": {"$in": oldest_ids}},
                    {"$set": {"status": "tombstoned", "updated_at": now}},
                )
                bg_task = asyncio.create_task(
                    self._purge_conversations_by_ids(oldest_ids)
                )
                self._background_tasks.add(bg_task)
                bg_task.add_done_callback(self._background_tasks.discard)

        # 4. Resolve UUID: if explicit id exists in DB (even if tombstoned/other user), mint a new one
        resolved_id = (
            conversation_id
            if (conversation_id and conversation_id != "default")
            else None
        )
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
            "session_emotional_state": {
                "active_tier": "NONE",
                "remaining_turns_ttl": 0,
                "topic_anchor": "",
            },
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
        session_emotional_state: dict[str, Any] | None = None,
    ) -> ExchangeResult:
        if client_message_id:
            existing = await self.get_exchange_by_client_message_id(
                user_id, client_message_id
            )
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
        if session_emotional_state is not None:
            update_fields["session_emotional_state"] = session_emotional_state

        # Auto-titling: If conversation has default title, set from first user message
        current_title = conversation.get("title")
        if not current_title or current_title in (
            "Đoạn chat mới",
            "Cuộc trò chuyện mới",
        ):
            raw_text = user_message.strip().replace("\n", " ")
            trimmed_title = (raw_text[:35] + "...") if len(raw_text) > 35 else raw_text
            if trimmed_title:
                update_fields["title"] = trimmed_title

        # Check substantive anchor locking
        existing_anchor = conversation.get("anchor_exchange")
        locked_anchor_this_turn = False
        current_turn_count = conversation.get("turn_count", 0)
        new_turn_count = current_turn_count + 1

        if not existing_anchor and is_substantive_anchor_turn(
            user_message, intent, policy_blocked
        ):
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
            locked_anchor_this_turn = getattr(anchor_res, "modified_count", 0) > 0

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

        conversation = await conv_col.find_one(
            {
                "id": conversation_id,
                "user_id": user_id,
                "status": {"$ne": "tombstoned"},
                "$or": [
                    {"last_message_at": {"$gte": cutoff}},
                    {"last_message_at": None, "created_at": {"$gte": cutoff}},
                ],
            }
        )
        if not conversation:
            return [], None, {}

        # Pre-v2 migration backfill: if turn_count is missing, backfill once from chat_messages
        if conversation.get("turn_count") is None:
            all_msgs_cursor = msg_col.find({"conversation_id": conversation_id}).sort(
                [("created_at", 1), ("id", 1)]
            )
            all_msgs = await all_msgs_cursor.to_list(length=1000)

            user_msgs = [m for m in all_msgs if m.get("role") == "user"]
            backfill_turn_count = len(user_msgs)
            backfill_tokens = sum(
                estimate_tokens(m.get("content", "")) for m in all_msgs
            )

            backfill_anchor: list[dict[str, Any]] = []
            backfill_anchor_turn: int | None = None

            # Find first substantive exchange
            for idx, u_msg in enumerate(user_msgs):
                u_intent = u_msg.get("intent")
                u_blocked = bool((u_msg.get("meta") or {}).get("policyBlocked", False))
                if is_substantive_anchor_turn(
                    u_msg.get("content", ""), u_intent, u_blocked
                ):
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
                                "content": (u_msg.get("content") or "")[
                                    :HISTORY_MESSAGE_CHAR_CAP
                                ],
                                "created_at": u_msg.get("created_at"),
                            },
                            {
                                "id": a_msg.get("id"),
                                "role": "assistant",
                                "content": (a_msg.get("content") or "")[
                                    :HISTORY_MESSAGE_CHAR_CAP
                                ],
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
            cursor = (
                msg_col.find({"conversation_id": conversation_id})
                .sort([("created_at", -1), ("id", -1)])
                .limit(40)
            )
            rows = await cursor.to_list(length=40)
            rows.reverse()
            history_items = [
                AssistantHistoryItem(role=r["role"], content=r["content"]) for r in rows
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
            (
                m["created_at"]
                for m in raw_anchor
                if "created_at" in m and m["created_at"]
            ),
            default=None,
        )
        anchor_items = [
            AssistantHistoryItem(role=m["role"], content=m["content"])
            for m in raw_anchor
        ]

        cursor = (
            msg_col.find({"conversation_id": conversation_id})
            .sort([("created_at", -1), ("id", -1)])
            .limit(6)
        )
        recent_rows = await cursor.to_list(length=6)
        recent_rows.reverse()

        # Deduplicate: drop any message already in anchor_exchange or created before/at anchor
        filtered_recent = [
            r
            for r in recent_rows
            if r.get("id") not in anchor_ids
            and (
                anchor_latest_time is None
                or r.get("created_at") is None
                or r.get("created_at", datetime.min.replace(tzinfo=timezone.utc))
                > anchor_latest_time
            )
        ]
        recent_items = [
            AssistantHistoryItem(role=r["role"], content=r["content"])
            for r in filtered_recent
        ]

        # Enforce hard ceiling of 2,000 tokens
        def _calc_total_tokens(items: list[AssistantHistoryItem]) -> int:
            return sum(
                estimate_tokens(i.content[:HISTORY_MESSAGE_CHAR_CAP]) for i in items
            )

        while (
            _calc_total_tokens(anchor_items + recent_items) > TOKEN_CEILING_HARD
            and len(recent_items) > 2
        ):
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

        cursor = (
            conv_col.find(self._active_conversation_filter(user_id, cutoff))
            .sort([("last_message_at", -1), ("created_at", -1)])
            .limit(limit)
        )

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
            await self.db["chat_messages"].delete_many(
                {"conversation_id": conversation_id}
            )
            return True
        return False

    async def get_exchange_by_client_message_id(
        self,
        user_id: str,
        client_message_id: str,
    ) -> tuple[dict[str, Any], dict[str, Any]] | None:
        user_msg = await self.db["chat_messages"].find_one(
            {
                "user_id": user_id,
                "role": "user",
                "client_message_id": client_message_id,
            }
        )
        if not user_msg:
            return None

        assistant_msg = await self.db["chat_messages"].find_one(
            {
                "conversation_id": user_msg["conversation_id"],
                "role": "assistant",
                "created_at": {"$gte": user_msg["created_at"]},
            },
            sort=[("created_at", 1)],
        )

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
            conversation = await self.db["chat_conversations"].find_one(
                {
                    "id": conversation_id,
                    "user_id": user_id,
                    "status": {"$ne": "tombstoned"},
                    "$or": [
                        {"last_message_at": {"$gte": cutoff}},
                        {"last_message_at": None, "created_at": {"$gte": cutoff}},
                    ],
                }
            )
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

        cursor = (
            self.db["chat_messages"]
            .find(query)
            .sort([("created_at", -1), ("id", -1)])
            .limit(page_size + 1)
        )
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
        cursor = (
            self.db["chat_messages"]
            .find(query)
            .sort([("created_at", -1), ("id", -1)])
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)
        return [str(d.get("content", "")) for d in docs if d.get("content")]

    async def is_conversation_active(
        self,
        user_id: str,
        conversation_id: str,
    ) -> bool:
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=SESSION_TTL_SECONDS)
        doc = await self.db["chat_conversations"].find_one(
            {
                "id": conversation_id,
                "user_id": user_id,
                "status": {"$ne": "tombstoned"},
                "$or": [
                    {"last_message_at": {"$gte": cutoff}},
                    {"last_message_at": None, "created_at": {"$gte": cutoff}},
                ],
            }
        )
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
            await self.db["chat_messages"].delete_many(
                {"conversation_id": {"$in": batch_ids}}
            )
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
            delete_filter = {
                "$or": [{"user_id": user_id}, {"conversation_id": {"$in": conv_ids}}]
            }

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
