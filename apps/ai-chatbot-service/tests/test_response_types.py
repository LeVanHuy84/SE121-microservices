import asyncio
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.assistant import AssistantService
from app.modules.chatbot.services.memory import session_memory
from app.modules.chatbot.services.prompt_builder import CRISIS_RESOURCES
from app.providers.base import LlmGeneration

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs" / "assistant"
CRISIS_MESSAGE = "tôi muốn chết"


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, prompt: str, request: AssistantRespondRequest):
        self.calls += 1
        return LlmGeneration(content="fake reply", model="test-model", provider="fake")


class FakeKafka:
    def __init__(self, fail: bool = False):
        self.fail = fail
        self.sent: list[tuple[str, dict]] = []

    async def send(self, topic: str, message: dict):
        if self.fail:
            raise RuntimeError("kafka down")
        self.sent.append((topic, message))


def _run(service: AssistantService, message: str, user: str, contexts=None):
    session_memory.clear_session(f"{user}:default")
    req = AssistantRespondRequest(
        userId=user,
        message=message,
        contexts=contexts or [],
    )
    return asyncio.run(service.respond(req))


def _with_kafka(kafka: FakeKafka):
    fake_module = types.ModuleType("app.modules.analysis.lifespan")
    fake_module.kafka_producer = kafka
    return patch.dict(sys.modules, {"app.modules.analysis.lifespan": fake_module})


class ResponseTypeTest(unittest.TestCase):
    def test_greeting_type(self):
        provider = FakeProvider()
        res = _run(AssistantService(provider=provider), "hello", "rt-1")
        self.assertEqual(res.type, "greeting")
        self.assertEqual(provider.calls, 0)

    def test_out_of_scope_type(self):
        provider = FakeProvider()
        res = _run(
            AssistantService(provider=provider),
            "How is the weather in Tokyo today?",
            "rt-2",
        )
        self.assertEqual(res.type, "out_of_scope")
        self.assertEqual(provider.calls, 0)

    def test_app_feature_without_context_is_no_answer(self):
        provider = FakeProvider()
        res = _run(
            AssistantService(provider=provider),
            "Chat hiện tại có chức năng video call không?",
            "rt-3",
        )
        self.assertEqual(res.type, "no_answer")
        self.assertEqual(provider.calls, 0)

    def test_answer_type_with_context(self):
        provider = FakeProvider()
        res = _run(
            AssistantService(provider=provider),
            "How do I use the app?",
            "rt-4",
            contexts=[
                AssistantContextItem(
                    type="help_doc",
                    id="feature-chat",
                    title="Chat",
                    content="Users can send direct messages.",
                    score=0.9,
                    source="docs",
                )
            ],
        )
        self.assertEqual(res.type, "answer")
        self.assertEqual(provider.calls, 1)

    def test_mental_health_without_context_still_calls_llm(self):
        provider = FakeProvider()
        res = _run(
            AssistantService(provider=provider),
            "Mình hay bị stress, làm sao để thư giãn?",
            "rt-5",
        )
        self.assertEqual(res.type, "answer")
        self.assertEqual(provider.calls, 1)


class CrisisAlertTest(unittest.TestCase):
    def test_alert_payload_has_no_message_text_and_reply_mentions_team(self):
        kafka = FakeKafka()
        provider = FakeProvider()
        with _with_kafka(kafka):
            res = _run(AssistantService(provider=provider), CRISIS_MESSAGE, "cr-1")

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.type, "crisis")
        self.assertIsNotNone(res.crisis)
        self.assertTrue(res.crisis.teamNotified)
        self.assertEqual(res.crisis.severity, "high")
        self.assertEqual(len(res.crisis.resources), len(CRISIS_RESOURCES))
        self.assertIn("đã được thông báo", res.reply)

        self.assertEqual(len(kafka.sent), 1)
        topic, message = kafka.sent[0]
        self.assertEqual(topic, "chatbot.crisis.alert")
        payload = message["payload"]
        self.assertEqual(
            set(payload),
            {"userId", "conversationId", "riskLevel", "reason", "timestamp"},
        )
        self.assertEqual(payload["riskLevel"], "high")
        self.assertEqual(payload["reason"], "explicit_crisis")
        self.assertNotIn("chết", str(message))
        self.assertNotIn("chet", str(message))

    def test_alert_failure_does_not_promise_notification(self):
        kafka = FakeKafka(fail=True)
        with _with_kafka(kafka):
            res = _run(AssistantService(provider=FakeProvider()), CRISIS_MESSAGE, "cr-2")

        self.assertEqual(res.type, "crisis")
        self.assertFalse(res.crisis.teamNotified)
        self.assertNotIn("đã được thông báo", res.reply)
        for _, phone in CRISIS_RESOURCES:
            self.assertIn(phone, res.reply)


class DocsLintTest(unittest.TestCase):
    def _guides(self):
        return {p.name: p.read_text(encoding="utf-8") for p in DOCS_DIR.glob("guide-*.md")}

    def test_no_false_end_to_end_encryption_claims(self):
        forbidden = (
            "không xem được",
            "không can thiệp được",
            "không ai khác biết",
            "tuyệt đối không được chia sẻ",
        )
        for name, text in self._guides().items():
            for phrase in forbidden:
                self.assertNotIn(phrase, text, f"{name}: '{phrase}'")
            if "mã hóa đầu cuối" in text:
                self.assertIn("chưa hỗ trợ mã hóa đầu cuối", text, name)

    def test_hotline_consistent_with_crisis_reply(self):
        for name, text in self._guides().items():
            if "111" in text:
                for _, phone in CRISIS_RESOURCES:
                    self.assertIn(phone, text, f"{name} thiếu {phone}")


if __name__ == "__main__":
    unittest.main()
