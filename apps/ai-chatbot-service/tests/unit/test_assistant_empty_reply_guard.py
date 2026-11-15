import asyncio
import os
import unittest
import uuid

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "true"

from app.modules.chatbot.repositories.chat_history import (
    ChatHistoryRepository,
    HistoryStore,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    UserMemoryProfileRepository,
)
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.assistant import (
    EMPTY_REPLY_FALLBACK,
    AssistantService,
)
from app.providers.base import LlmGeneration, ToolCallInfo
from app.providers.resilient_provider import CircuitOpenSkippedError
from tests.unit.test_chat_history_actions import FakeDb

SAMPLE_CONTEXT = [
    AssistantContextItem(
        type="help_doc",
        id="feature-chat",
        title="Chat",
        content="Users can send direct messages.",
        score=0.9,
        source="docs",
    )
]


class FailingProvider:
    def __init__(self, exc: Exception):
        self.exc = exc

    async def generate(self, prompt, request, **kwargs):
        raise self.exc


class EmptyContentProvider:
    async def generate(self, prompt, request, **kwargs):
        return LlmGeneration(
            content="   \n  ",
            model="groq-test",
            provider="groq",
            tool_calls=(),
        )


class ToolCallingThenFailingProvider:
    def __init__(self):
        self.step = 0

    async def generate(self, prompt, request, **kwargs):
        self.step += 1
        if self.step == 1:
            return LlmGeneration(
                content="",
                model="groq-test",
                provider="groq",
                tool_calls=(
                    ToolCallInfo(
                        id="call_1",
                        name="get_current_time",
                        args={},
                    ),
                ),
            )
        raise RuntimeError("Groq retry limit exceeded on tool synthesis")


class FakeContextResolver:
    async def resolve(self, request, history, *args, **kwargs):
        return request.contexts or []


class AssistantEmptyReplyGuardTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        self.repo = ChatHistoryRepository(db=self.db)
        self.history_store = HistoryStore(repository=self.repo)
        self.profile_repo = UserMemoryProfileRepository(db=self.db)
        self.context_resolver = FakeContextResolver()

    def test_provider_exception_returns_safe_fallback_reply(self):
        service = AssistantService(
            provider=FailingProvider(RuntimeError("Groq retry limit exceeded")),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-fail-1",
            conversationId=str(uuid.uuid4()),
            message="Làm sao để dùng ứng dụng nhắn tin?",
            aiPolicy="FULL",
            contexts=SAMPLE_CONTEXT,
        )
        res = asyncio.run(service.respond(req))

        self.assertEqual(res.type, "fallback")
        self.assertEqual(res.reply, EMPTY_REPLY_FALLBACK)
        self.assertTrue(len(res.reply.strip()) > 0)
        self.assertEqual(res.suggestedActions, [])
        self.assertEqual(res.proposals, [])

    def test_circuit_breaker_open_returns_safe_fallback_reply(self):
        service = AssistantService(
            provider=FailingProvider(
                CircuitOpenSkippedError("Primary LLM circuit breaker is OPEN")
            ),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-fail-2",
            conversationId=str(uuid.uuid4()),
            message="Làm sao để dùng ứng dụng nhắn tin?",
            aiPolicy="FULL",
            contexts=SAMPLE_CONTEXT,
        )
        res = asyncio.run(service.respond(req))

        self.assertEqual(res.type, "fallback")
        self.assertEqual(res.reply, EMPTY_REPLY_FALLBACK)
        self.assertTrue(len(res.reply.strip()) > 0)

    def test_empty_content_from_provider_guarded_to_fallback(self):
        service = AssistantService(
            provider=EmptyContentProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-fail-3",
            conversationId=str(uuid.uuid4()),
            message="Làm sao để dùng ứng dụng nhắn tin?",
            aiPolicy="FULL",
            contexts=SAMPLE_CONTEXT,
        )
        res = asyncio.run(service.respond(req))

        self.assertEqual(res.type, "fallback")
        self.assertEqual(res.reply, EMPTY_REPLY_FALLBACK)
        self.assertTrue(len(res.reply.strip()) > 0)

    def test_tool_synthesis_failure_returns_fallback_reply(self):
        service = AssistantService(
            provider=ToolCallingThenFailingProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-fail-4",
            conversationId=str(uuid.uuid4()),
            message="Làm sao để dùng ứng dụng nhắn tin?",
            aiPolicy="FULL",
            contexts=SAMPLE_CONTEXT,
        )
        res = asyncio.run(service.respond(req))

        self.assertEqual(res.type, "fallback")
        self.assertEqual(res.reply, EMPTY_REPLY_FALLBACK)
        self.assertTrue(len(res.reply.strip()) > 0)


if __name__ == "__main__":
    unittest.main()
