import asyncio
import os
import unittest
from datetime import datetime, timezone

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from app.modules.chatbot.repositories.chat_history import ChatHistoryRepository, HistoryStore
from app.modules.chatbot.schemas import NavigateAction, NavigatePayload


class FakeCollection:
    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, query, *args, **kwargs):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in query.items()):
                return doc
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def insert_many(self, docs):
        self.docs.extend(docs)

    async def update_one(self, *args, **kwargs):
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
        user_msg, assistant_msg = asyncio.run(
            self.repo.append_exchange("u1", "mở quyền riêng tư", "Đây nhé", actions=serialized)
        )

        self.assertNotIn("actions", user_msg["meta"])
        self.assertEqual(assistant_msg["meta"]["actions"], serialized)
        self.assertEqual(assistant_msg["meta"]["message_kind"], "assistant")

    def test_append_exchange_without_actions_omits_key(self):
        _, assistant_msg = asyncio.run(self.repo.append_exchange("u1", "hello", "hi"))
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
