import asyncio
import os
import unittest
import uuid

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "true"

from app.modules.chatbot.repositories.chat_history import ChatHistoryRepository, HistoryStore
from app.modules.chatbot.repositories.user_memory_profile import UserMemoryProfileRepository
from app.modules.chatbot.schemas import AssistantContextItem, AssistantRespondRequest
from app.modules.chatbot.services.assistant import AssistantService
from app.providers.base import LlmGeneration
from tests.unit.test_chat_history_actions import FakeDb


class FakeProvider:
    def __init__(self):
        self.calls = 0

    async def generate(self, prompt: str, request: AssistantRespondRequest, **kwargs):
        self.calls += 1
        return LlmGeneration(
            content=f"fake reply for: {request.message}",
            model="test-model",
            provider="fake",
        )


class FakeContextResolver:
    async def resolve(self, request, history, *args, **kwargs):
        return request.contexts or []


class AssistantServiceTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        self.repo = ChatHistoryRepository(db=self.db)
        self.history_store = HistoryStore(repository=self.repo)
        self.profile_repo = UserMemoryProfileRepository(db=self.db)
        self.context_resolver = FakeContextResolver()

    def test_provider_returns_reply_and_sources(self):
        service = AssistantService(
            provider=FakeProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        test_conv_id = str(uuid.uuid4())
        req = AssistantRespondRequest(
            userId="user-1",
            conversationId=test_conv_id,
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
        self.assertEqual(res.conversationId, test_conv_id)
        uuid.UUID(res.conversationId)

    def test_out_of_scope_question_skips_provider_and_is_stored(self):
        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )

        req = AssistantRespondRequest(
            userId="user-1",
            message="How is the weather in Tokyo today?",
        )

        res = asyncio.run(service.respond(req))
        page = asyncio.run(self.history_store.get_messages_page_by_user("user-1", conversation_id=res.conversationId))

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.model, "scope-guard")
        self.assertIn("Sentimeta", res.reply)
        self.assertNotEqual(res.conversationId, "default")
        uuid.UUID(res.conversationId)
        self.assertEqual(len(page.items), 2)
        # page.items is newest-first from chat_messages
        self.assertEqual(page.items[0].role, "assistant")
        self.assertEqual(page.items[1].role, "user")

    def test_greeting_skips_provider_even_when_contexts_present(self):
        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
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
        self.assertNotEqual(res.conversationId, "default")
        uuid.UUID(res.conversationId)

    def test_in_domain_unknown_feature_question_is_not_out_of_scope(self):
        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-2",
            message="Chat hiện tại có chức năng video call không?",
        )

        res = asyncio.run(service.respond(req))

        self.assertEqual(provider.calls, 0)
        self.assertEqual(res.model, "scope-guard")
        self.assertIn("thuộc phạm vi", res.reply)
        self.assertNotEqual(res.conversationId, "default")
        uuid.UUID(res.conversationId)

    def test_follow_up_anchor_allows_provider_after_topic_switch(self):
        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )

        first = AssistantRespondRequest(
            userId="user-3",
            message="Cách bật quyền riêng tư hồ sơ?",
            contexts=[
                AssistantContextItem(
                    type="help_doc",
                    id="privacy-profile",
                    title="Quyền riêng tư",
                    content="Vào Cài đặt > Quyền riêng tư để thiết lập hồ sơ.",
                    score=0.9,
                    source="docs",
                )
            ],
        )
        res_first = asyncio.run(service.respond(first))
        conv_id = res_first.conversationId
        self.assertNotEqual(conv_id, "default")
        uuid.UUID(conv_id)

        second = AssistantRespondRequest(
            userId="user-3",
            conversationId=conv_id,
            message="Ok, còn tìm nhóm thì sao?",
            contexts=[
                AssistantContextItem(
                    type="help_doc",
                    id="search-group",
                    title="Tìm nhóm",
                    content="Dùng ô tìm kiếm và lọc theo nhóm.",
                    score=0.85,
                    source="docs",
                )
            ],
        )
        _ = asyncio.run(service.respond(second))

        third = AssistantRespondRequest(
            userId="user-3",
            conversationId=conv_id,
            message="quay lại cái trước đó đi",
            contexts=[
                AssistantContextItem(
                    type="help_doc",
                    id="privacy-profile-2",
                    title="Quyền riêng tư hồ sơ",
                    content="Bạn có thể chỉnh quyền xem hồ sơ trong phần Privacy.",
                    score=0.88,
                    source="docs",
                )
            ],
        )
        res = asyncio.run(service.respond(third))

        self.assertGreaterEqual(provider.calls, 3)
        self.assertIn("fake reply for", res.reply)
        self.assertEqual(res.conversationId, conv_id)


if __name__ == "__main__":
    unittest.main()
