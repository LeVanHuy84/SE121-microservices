import asyncio
import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from app.memory.session_memory import session_memory
from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantContextItem, AssistantRespondRequest
from app.services.assistant_service import AssistantService


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, prompt: str, request: AssistantRespondRequest):
        self.calls += 1
        return LlmGeneration(
            content=f"fake reply for: {request.message}",
            model="test-model",
            provider="fake",
        )


class AssistantServiceTest(unittest.TestCase):
    def test_provider_returns_reply_and_sources(self):
        service = AssistantService(provider=FakeProvider())
        req = AssistantRespondRequest(
            userId="user-1",
            conversationId="conv-1",
            message="How do I use the app?",
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

        res = asyncio.run(service.respond(req))

        self.assertIn("How do I use the app?", res.reply)
        self.assertEqual(res.provider, "fake")
        self.assertEqual(len(res.sources), 1)

    def test_out_of_scope_question_skips_provider_and_is_stored(self):
        provider = FakeProvider()
        service = AssistantService(provider=provider)
        session_key = "user-1:default"
        session_memory.clear_session(session_key)

        req = AssistantRespondRequest(
            userId="user-1",
            message="How is the weather in Tokyo today?",
        )

        res = asyncio.run(service.respond(req))
        recent = session_memory.get_recent(session_key, 2)

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.model, "scope-guard")
        self.assertIn("Sentimeta", res.reply)
        self.assertEqual(len(recent), 2)
        self.assertEqual(recent[0].role, "user")
        self.assertEqual(recent[1].role, "assistant")

        session_memory.clear_session(session_key)

    def test_greeting_skips_provider_even_when_contexts_present(self):
        provider = FakeProvider()
        service = AssistantService(provider=provider)
        req = AssistantRespondRequest(
            userId="user-1",
            message="hello",
            contexts=[
                AssistantContextItem(
                    type="group",
                    id="group-hello",
                    title="hello",
                    content="Nhóm hello có điểm 4.9",
                    score=0.95,
                    source="group-service",
                )
            ],
        )

        res = asyncio.run(service.respond(req))

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.model, "greeting-guard")
        self.assertIn("Xin chào", res.reply)


if __name__ == "__main__":
    unittest.main()
