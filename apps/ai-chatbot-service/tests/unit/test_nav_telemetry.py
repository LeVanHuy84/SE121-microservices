import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from app.modules.chatbot.navigation.telemetry import IntentTelemetryService, hash_user_id
from app.modules.chatbot.schemas import NavigateAction, NavigatePayload

DB_PATCH = "app.modules.chatbot.navigation.telemetry.get_database"


def _action(destination_id: str) -> NavigateAction:
    return NavigateAction(label=destination_id, payload=NavigatePayload(destinationId=destination_id))


class FakeEvents:
    """In-memory stand-in for the assistant_intent_events collection."""

    def __init__(self):
        self.docs: list[dict] = []

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, query, update):
        for doc in self.docs:
            if (
                doc["user_id_hash"] == query["user_id_hash"]
                and query["action_ids"] in doc["action_ids"]
                and doc["clicked"] == query["clicked"]
            ):
                doc.update(update["$set"])
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    async def count_documents(self, query):
        if not query:
            return len(self.docs)
        return sum(1 for d in self.docs if all(d.get(k) == v for k, v in query.items()))


class FakeDb:
    def __init__(self):
        self.events = FakeEvents()

    def __getitem__(self, name):
        assert name == "assistant_intent_events"
        return self.events


class IntentTelemetryTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        patcher = patch(DB_PATCH, return_value=self.db)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.service = IntentTelemetryService()

    def _offer(self, user_id, actions, path="command"):
        async def run():
            self.service.track_offer(user_id, actions, path)
            await asyncio.gather(*self.service._pending)

        asyncio.run(run())

    def test_offer_stores_only_hashed_user_and_ids_no_message_text(self):
        action = _action("settings.privacy")
        self._offer("user-1", [action])

        (doc,) = self.db.events.docs
        self.assertEqual(doc["user_id_hash"], hash_user_id("user-1"))
        self.assertNotIn("user-1", str(doc))
        self.assertEqual(doc["action_ids"], [action.id])
        self.assertEqual(doc["destination_ids_offered"], ["settings.privacy"])
        self.assertEqual(doc["resolver_path"], "command")
        self.assertFalse(doc["clicked"])
        self.assertFalse({"normalized_intent_tokens", "message", "text"} & set(doc))

    def test_offer_without_actions_records_nothing(self):
        self._offer("user-1", [])
        self.assertEqual(self.db.events.docs, [])

    def test_click_marks_the_offer_containing_that_action(self):
        first, second = _action("settings.privacy"), _action("settings.privacy")
        self._offer("user-1", [first])
        self._offer("user-1", [second])

        recorded = asyncio.run(self.service.record_action_click("user-1", second.id, "settings.privacy"))

        self.assertTrue(recorded)
        by_action = {doc["action_ids"][0]: doc for doc in self.db.events.docs}
        self.assertTrue(by_action[second.id]["clicked"])
        self.assertFalse(by_action[first.id]["clicked"])
        self.assertEqual(by_action[second.id]["clicked_destination_id"], "settings.privacy")

    def test_click_from_other_user_is_ignored(self):
        action = _action("settings.privacy")
        self._offer("user-1", [action])

        recorded = asyncio.run(self.service.record_action_click("user-2", action.id, "settings.privacy"))

        self.assertFalse(recorded)
        self.assertFalse(self.db.events.docs[0]["clicked"])

    def test_click_with_unknown_destination_is_rejected_without_db_write(self):
        action = _action("settings.privacy")
        self._offer("user-1", [action])

        recorded = asyncio.run(self.service.record_action_click("user-1", action.id, "admin.dashboard"))

        self.assertFalse(recorded)
        self.assertFalse(self.db.events.docs[0]["clicked"])

    def test_click_is_recorded_once(self):
        action = _action("settings.privacy")
        self._offer("user-1", [action])

        first = asyncio.run(self.service.record_action_click("user-1", action.id, "settings.privacy"))
        second = asyncio.run(self.service.record_action_click("user-1", action.id, "settings.privacy"))

        self.assertTrue(first)
        self.assertFalse(second)

    def test_db_failure_never_raises(self):
        with patch(DB_PATCH, side_effect=RuntimeError("db down")):
            self._offer("user-1", [_action("settings.privacy")])
            recorded = asyncio.run(self.service.record_action_click("user-1", "x", "settings.privacy"))
        self.assertFalse(recorded)

    def test_track_offer_outside_event_loop_is_a_noop(self):
        self.service.track_offer("user-1", [_action("settings.privacy")], "command")
        self.assertEqual(self.db.events.docs, [])

    def test_get_stats_calculates_ctr_correctly(self):
        act1, act2 = _action("settings.privacy"), _action("settings.notifications")
        self._offer("u1", [act1])
        self._offer("u2", [act2])
        asyncio.run(self.service.record_action_click("u1", act1.id, "settings.privacy"))

        stats = asyncio.run(self.service.get_stats())
        self.assertEqual(stats["total_offers"], 2)
        self.assertEqual(stats["total_clicks"], 1)
        self.assertEqual(stats["ctr_percentage"], 50.0)


if __name__ == "__main__":
    unittest.main()
