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
            aiPolicy="FULL",
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

    def test_empty_provider_reply_is_replaced_with_safe_fallback(self):
        class EmptyProvider:
            async def generate(self, prompt, request, **kwargs):
                return LlmGeneration(content="  ", model="test-model", provider="fake")

        service = AssistantService(
            provider=EmptyProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        req = AssistantRespondRequest(
            userId="user-1",
            conversationId=str(uuid.uuid4()),
            message="How do I use the app?",
            aiPolicy="FULL",
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

        self.assertTrue(res.reply.strip())
        self.assertEqual(res.type, "fallback")

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
        page = asyncio.run(
            self.history_store.get_messages_page_by_user(
                "user-1", conversation_id=res.conversationId
            )
        )

        self.assertEqual(provider.calls, 1)
        self.assertEqual(res.type, "out_of_scope")
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
            aiPolicy="FULL",
        )

        res = asyncio.run(service.respond(req))

        self.assertEqual(provider.calls, 1)
        self.assertEqual(res.type, "no_answer")
        self.assertNotEqual(res.type, "out_of_scope")
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
            aiPolicy="FULL",
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
            aiPolicy="FULL",
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
            aiPolicy="FULL",
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

        self.assertGreaterEqual(provider.calls, 2)
        self.assertIn("fake reply for", res.reply)
        self.assertEqual(res.conversationId, conv_id)

    def test_opening_message_not_replaced_by_proactive_checkin(self):
        from unittest.mock import AsyncMock, MagicMock
        from app.modules.chatbot.services.emotion_context import EmotionSnapshot

        provider = FakeProvider()
        fact_extractor = MagicMock()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
            fact_extractor=fact_extractor,
        )
        service._respond_command.emotion_ctx = MagicMock()
        service._respond_command.emotion_ctx.get_snapshot = AsyncMock(
            return_value=EmotionSnapshot(
                primary_emotion="sadness",
                risk_level="high",
                chatbot_prompt_context="Proactive context",
            )
        )
        req = AssistantRespondRequest(
            userId="user-proactive",
            message="xin chào",
            aiPolicy="FULL",
        )
        res = asyncio.run(service.respond(req))
        self.assertEqual(res.model, "greeting-guard")
        self.assertIn("Xin chào", res.reply)

    def test_restricted_policy_strips_personal_data_and_skips_fact_extractor(self):
        from unittest.mock import AsyncMock, MagicMock

        provider = FakeProvider()
        fact_extractor = MagicMock()
        profile_repo = MagicMock()
        profile_repo.get_facts_by_user = AsyncMock(return_value={"name": "An"})
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=profile_repo,
            context_resolver=self.context_resolver,
            fact_extractor=fact_extractor,
        )
        service._respond_command.nav_resolver = MagicMock(
            resolve=MagicMock(return_value=None)
        )
        service._respond_command.emotion_ctx = MagicMock()
        service._respond_command.emotion_ctx.get_snapshot = AsyncMock()

        req = AssistantRespondRequest(
            userId="user-restricted",
            message="Tìm bài viết thịnh hành trên Sentimeta",
            aiPolicy="RESTRICTED",
            contexts=[
                AssistantContextItem(
                    type="personal_post",
                    id="p-1",
                    content="Secret personal context",
                    score=0.9,
                )
            ],
        )
        _ = asyncio.run(service.respond(req))
        profile_repo.get_facts_by_user.assert_awaited_once_with("user-restricted")
        service._respond_command.emotion_ctx.get_snapshot.assert_not_awaited()
        fact_extractor.maybe_schedule_extraction.assert_called_once()

        # Safety guardrails remain active under RESTRICTED
        crisis_req = AssistantRespondRequest(
            userId="user-restricted",
            message="Tôi muốn tự tử",
            aiPolicy="RESTRICTED",
        )
        crisis_res = asyncio.run(service.respond(crisis_req))
        self.assertEqual(crisis_res.type, "crisis")

    def test_system_turn_suppresses_tone_without_erasing_distress_continuity(self):
        from app.modules.chatbot.services.assistant_support.turn_preparer import (
            TurnPreparer,
        )

        provider = FakeProvider()
        service = AssistantService(
            provider=provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        preparer = TurnPreparer(service._respond_command)
        # First turn: emotional distress sets session_emotional_state
        req1 = AssistantRespondRequest(
            userId="user-sys-1",
            message="Mình đang rất lo âu và hoảng loạn",
            aiPolicy="FULL",
        )
        res1 = asyncio.run(service.respond(req1))
        conv_id = res1.conversationId

        # Second turn: system/product query with distress_level == "none" resets session_emotional_state
        req2 = AssistantRespondRequest(
            userId="user-sys-1",
            conversationId=conv_id,
            message="Làm sao để bật thông báo bài viết mới trên Sentimeta?",
            aiPolicy="FULL",
        )
        turn2 = asyncio.run(preparer.prepare_turn(req2, 0.0, "req-2"))
        self.assertTrue(turn2.is_system_turn)
        self.assertEqual(turn2.session_emotional_state.get("active_tier"), "NONE")
        self.assertEqual(turn2.session_emotional_state.get("remaining_turns_ttl"), 0)

    def test_execute_stream_post_tool_extracts_signed_proposals_and_respects_policy(
        self,
    ):
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.chatbot.tools.dispatcher import (
            ToolDispatcher,
            ToolExecutionContext,
        )
        from app.providers.base import LlmChunk, ToolCallInfo

        class StreamToolProvider:
            supports_chat_messages = True
            supports_tools = True

            def __init__(self):
                self.calls = 0

            async def generate(self, prompt, request, **kwargs):
                raise AssertionError("generate not expected")

            async def stream(self, input_data, request, **kwargs):
                self.calls += 1
                if self.calls % 2 == 1:
                    yield LlmChunk(
                        content="",
                        tool_calls=(
                            ToolCallInfo(
                                id="tc-1",
                                name="search_users",
                                args={"query": "Nam"},
                            ),
                        ),
                    )
                else:
                    yield LlmChunk(
                        content=(
                            "Mình đã tìm thấy Nam.\n"
                            "```action\n"
                            '{"actionName":"send_friend_request","title":"Kết bạn","params":{"target_user_id":"u-nam-1"}}\n'
                            "```\n"
                        )
                    )

        dispatcher = ToolDispatcher()
        dispatcher.register_handler(
            "search_users",
            AsyncMock(return_value={"users": [{"id": "u-nam-1", "name": "Nam"}]}),
        )
        service = AssistantService(
            provider=StreamToolProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )
        service._respond_command.dispatcher = dispatcher
        service._respond_command.nav_resolver = MagicMock()
        service._respond_command.nav_resolver.resolve.return_value = None

        async def _collect(policy: str):
            req = AssistantRespondRequest(
                userId="u-stream-1",
                message="Mình muốn kết nối bạn bè với Nam",
                aiPolicy=policy,
            )
            return [
                chunk async for chunk in service._respond_command.execute_stream(req)
            ]

        chunks_full = asyncio.run(_collect("FULL"))
        proposals_full = [p for c in chunks_full for p in c.proposals]
        self.assertEqual(len(proposals_full), 1)
        self.assertEqual(proposals_full[0].payload.actionName, "send_friend_request")
        self.assertTrue(proposals_full[0].payload.proposalToken)
        self.assertNotIn("```action", "".join(c.reply for c in chunks_full))

        chunks_restricted = asyncio.run(_collect("RESTRICTED"))
        proposals_restricted = [p for c in chunks_restricted for p in c.proposals]
        self.assertEqual(proposals_restricted, [])

        # Defense-in-depth: personal tool blocked under RESTRICTED
        blocked = asyncio.run(
            dispatcher.dispatch(
                "get_my_friends",
                {},
                ToolExecutionContext(user_id="u-stream-1", ai_policy="RESTRICTED"),
            )
        )
        self.assertFalse(blocked.success)
        self.assertIn("riêng tư", blocked.error or "")

    def test_execute_stream_empty_reply_yields_safe_fallback(self):
        from app.providers.base import LlmChunk

        class EmptyStreamProvider:
            supports_chat_messages = True
            supports_tools = False

            async def generate(self, prompt, request, **kwargs):
                raise AssertionError("generate not expected")

            async def stream(self, input_data, request, **kwargs):
                yield LlmChunk(content="")

        service = AssistantService(
            provider=EmptyStreamProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )

        async def _collect():
            req = AssistantRespondRequest(
                userId="u-stream-2",
                conversationId=str(uuid.uuid4()),
                message="How do I use the app?",
                aiPolicy="FULL",
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
            return [c async for c in service._respond_command.execute_stream(req)]

        chunks = asyncio.run(_collect())

        self.assertTrue("".join(c.reply for c in chunks).strip())
        self.assertEqual(chunks[-1].type, "fallback")


if __name__ == "__main__":
    unittest.main()
