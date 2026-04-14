import asyncio
import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")

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

    def test_out_of_scope_question_skips_provider(self):
        provider = FakeProvider()
        service = AssistantService(provider=provider)
        req = AssistantRespondRequest(
            userId="user-1",
            message="Hôm nay thời tiết ở Tokyo thế nào?",
        )

        res = asyncio.run(service.respond(req))

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.model, "scope-guard")
        self.assertIn("Sentimeta", res.reply)


if __name__ == "__main__":
    unittest.main()
