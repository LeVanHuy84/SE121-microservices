import asyncio
import os
import unittest
from datetime import datetime, timezone
from typing import Any

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from app.modules.chatbot.repositories.chat_history import ChatHistoryRepository, HistoryStore
from app.modules.chatbot.schemas import NavigateAction, NavigatePayload


class FakeCursor:
    def __init__(self, docs: list[dict]):
        self._docs = list(docs)

    def sort(self, sort_keys):
        for key, direction in reversed(sort_keys):
            reverse = direction == -1
            self._docs.sort(
                key=lambda d: (d.get(key) is not None, d.get(key) if d.get(key) is not None else ""),
                reverse=reverse,
            )
        return self

    def limit(self, n: int):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, length: int | None = None):
        if length is not None:
            return self._docs[:length]
        return self._docs


class FakeCollection:
    def __init__(self):
        self.docs: list[dict] = []

    def _matches(self, doc: dict, query: dict) -> bool:
        for k, v in query.items():
            if k == "$or":
                if not any(self._matches(doc, sub) for sub in v):
                    return False
            elif isinstance(v, dict):
                val = doc.get(k)
                for op, op_val in v.items():
                    if op == "$ne":
                        if val == op_val:
                            return False
                    elif op == "$gte":
                        if val is None or val < op_val:
                            return False
                    elif op == "$lt":
                        if val is None or val >= op_val:
                            return False
                    elif op == "$in":
                        if val not in op_val:
                            return False
            else:
                if doc.get(k) != v:
                    return False
        return True

    async def find_one(self, query, *args, **kwargs):
        sort_keys = kwargs.get("sort")
        matching = [d for d in self.docs if self._matches(d, query)]
        if sort_keys:
            cursor = FakeCursor(matching)
            cursor.sort(sort_keys)
            matching = await cursor.to_list()
        return matching[0] if matching else None

    def find(self, query=None, *args, **kwargs):
        query = query or {}
        matching = [d for d in self.docs if self._matches(d, query)]
        return FakeCursor(matching)

    async def count_documents(self, query=None, *args, **kwargs) -> int:
        query = query or {}
        return sum(1 for d in self.docs if self._matches(d, query))

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def insert_many(self, docs):
        self.docs.extend([dict(d) for d in docs])

    async def update_one(self, query, update, *args, **kwargs):
        for doc in self.docs:
            if self._matches(doc, query):
                self._apply_update(doc, update)
                return type("UpdateResult", (), {"modified_count": 1, "matched_count": 1})()
        if kwargs.get("upsert"):
            new_doc = dict(query)
            self._apply_update(new_doc, update)
            self.docs.append(new_doc)
            return type("UpdateResult", (), {"modified_count": 0, "upserted_id": new_doc.get("_id")})()
        return type("UpdateResult", (), {"modified_count": 0, "matched_count": 0})()

    async def update_many(self, query, update, *args, **kwargs):
        count = 0
        for doc in self.docs:
            if self._matches(doc, query):
                self._apply_update(doc, update)
                count += 1
        return type("UpdateResult", (), {"modified_count": count, "matched_count": count})()

    def _apply_update(self, doc: dict, update: dict):
        if "$set" in update:
            for k, v in update["$set"].items():
                if "." in k:
                    parts = k.split(".")
                    cur = doc
                    for part in parts[:-1]:
                        cur = cur.setdefault(part, {})
                    cur[parts[-1]] = v
                else:
                    doc[k] = v
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = doc.get(k, 0) + v
        if "$unset" in update:
            for k in update["$unset"]:
                if "." in k:
                    parts = k.split(".")
                    cur = doc
                    for part in parts[:-1]:
                        if part in cur:
                            cur = cur[part]
                        else:
                            break
                    else:
                        cur.pop(parts[-1], None)
                else:
                    doc.pop(k, None)

    async def delete_one(self, query, *args, **kwargs):
        for idx, doc in enumerate(self.docs):
            if self._matches(doc, query):
                del self.docs[idx]
                return type("DeleteResult", (), {"deleted_count": 1})()
        return type("DeleteResult", (), {"deleted_count": 0})()

    async def delete_many(self, query, *args, **kwargs):
        initial = len(self.docs)
        self.docs = [d for d in self.docs if not self._matches(d, query)]
        deleted = initial - len(self.docs)
        return type("DeleteResult", (), {"deleted_count": deleted})()

    async def create_index(self, *args, **kwargs):
        return None

    async def drop_index(self, *args, **kwargs):
        return None


class FakeDb:
    def __init__(self):
        self.collections: dict[str, FakeCollection] = {}

    def __getitem__(self, name: str) -> FakeCollection:
        return self.collections.setdefault(name, FakeCollection())


ACTION = NavigateAction(label="Quyền riêng tư", payload=NavigatePayload(destinationId="settings.privacy"))


class ChatHistoryActionsTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        self.repo = ChatHistoryRepository(db=self.db)

    def test_append_exchange_persists_actions_on_assistant_message_only(self):
        serialized = [ACTION.model_dump()]
        user_msg, assistant_msg, _, _ = asyncio.run(
            self.repo.append_exchange("u1", "mở quyền riêng tư", "Đây nhé", actions=serialized)
        )

        self.assertNotIn("actions", user_msg["meta"])
        self.assertEqual(assistant_msg["meta"]["actions"], serialized)
        self.assertEqual(assistant_msg["meta"]["message_kind"], "assistant")

    def test_append_exchange_without_actions_omits_key(self):
        user_msg, assistant_msg, _, _ = asyncio.run(self.repo.append_exchange("u1", "hello", "hi"))
        self.assertNotIn("actions", assistant_msg["meta"])

    def test_history_message_exposes_actions_in_metadata(self):
        store = HistoryStore(repository=self.repo)
        row = {
            "id": "m1",
            "conversation_id": "c1",
            "user_id": "u1",
            "role": "assistant",
            "content": "Đây nhé",
            "intent": None,
            "sources": [],
            "meta": {"message_kind": "assistant", "actions": [ACTION.model_dump()]},
            "created_at": datetime.now(timezone.utc),
        }

        message = store._to_history_message(row)

        self.assertEqual(message.metadata["actions"][0]["payload"]["destinationId"], "settings.privacy")
        self.assertEqual(message.metadata["actions"][0]["type"], "navigate")


if __name__ == "__main__":
    unittest.main()
