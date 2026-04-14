import asyncio
import os
import unittest

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")

from app.providers.base import LlmGeneration
from app.schemas.assistant_schema import AssistantContextItem, AssistantRespondRequest
from app.services.assistant_service import AssistantService


class FakeProvider:
    async def generate(self, prompt: str, request: AssistantRespondRequest):
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


if __name__ == "__main__":
    unittest.main()
