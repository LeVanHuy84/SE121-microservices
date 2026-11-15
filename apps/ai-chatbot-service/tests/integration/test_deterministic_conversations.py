from __future__ import annotations

import asyncio
import os
import unittest
import uuid
from unittest.mock import AsyncMock, patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "true"
os.environ["CHATBOT_PROMPT_HISTORY_ITEMS_MAX"] = "8"
os.environ["CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A"] = "8"
os.environ["CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B"] = "8"

from app.modules.chatbot.repositories.chat_history import (
    ChatHistoryRepository,
    HistoryStore,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    UserMemoryProfileRepository,
)
from app.modules.chatbot.schemas import AssistantRespondData, AssistantRespondRequest
from app.modules.chatbot.services.assistant import AssistantService
from app.providers.stub_provider import StubLlmProvider
from tests.unit.test_chat_history_actions import FakeDb


class FakeContextResolver:
    async def resolve(self, request, history, *args, **kwargs):
        return request.contexts or []


class DeterministicConversationTests(unittest.TestCase):
    """Deterministic multi-turn conversation test suite using StubLlmProvider.
    Zero external LLM tokens burned. 100% reproducible and isolated.
    """

    def setUp(self) -> None:
        self._patcher1 = patch(
            "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
            new=AsyncMock(return_value=[0.0] * 768),
        )
        self._patcher2 = patch(
            "app.modules.chatbot.services.embedding.embedding_service.encode_query",
            return_value=[0.0] * 768,
        )
        self._patcher1.start()
        self._patcher2.start()

        from app.core.settings import settings

        self._orig_history_max = settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX
        settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX = 8
        settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_A = 8
        settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX_B = 8

        self.db = FakeDb()
        self.repo = ChatHistoryRepository(db=self.db)
        self.history_store = HistoryStore(repository=self.repo)
        self.profile_repo = UserMemoryProfileRepository(db=self.db)
        self.context_resolver = FakeContextResolver()
        self.provider = StubLlmProvider()

        self.service = AssistantService(
            provider=self.provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
            context_resolver=self.context_resolver,
        )

    def tearDown(self) -> None:
        from app.core.settings import settings

        settings.CHATBOT_PROMPT_HISTORY_ITEMS_MAX = self._orig_history_max
        self._patcher1.stop()
        self._patcher2.stop()

    def _post(
        self,
        user_id: str,
        message: str,
        conversation_id: str | None = None,
    ) -> AssistantRespondData:
        req = AssistantRespondRequest(
            userId=user_id,
            conversationId=conversation_id or str(uuid.uuid4()),
            message=message,
            aiPolicy="FULL",
        )
        return asyncio.run(self.service.respond(req))

    def test_support_conversation_preserves_context_across_turns(self) -> None:
        user_id = f"mock_user_{uuid.uuid4().hex[:8]}"

        # Turn 1: Introduction & Stress
        first = self._post(
            user_id,
            "Chào bạn, mình tên là Minh. Hôm nay mình thấy khá áp lực vì công việc.",
        )
        conv_id = first.conversationId
        self.assertTrue((first.reply or "").strip())
        self.assertNotEqual(first.type, "crisis")

        # Turn 2: Sleep & Listening
        second = self._post(
            user_id,
            "Mình còn khó ngủ vì cứ suy nghĩ về deadline. Bạn có thể lắng nghe mình không?",
            conv_id,
        )
        self.assertTrue((second.reply or "").strip())
        self.assertNotEqual(second.type, "crisis")
        self.assertFalse(second.policyBlocked)

        # Turn 3: Music preference
        third = self._post(
            user_id,
            "Mình thường nghe nhạc lo-fi để thư giãn. Bạn gợi ý cho mình một cách thư giãn tối nay nhé.",
            conv_id,
        )
        self.assertTrue((third.reply or "").strip())
        self.assertNotEqual(third.type, "crisis")

        # Turn 4: Context Recall
        final = self._post(
            user_id,
            "Bạn còn nhớ tên mình và loại nhạc mình thích để thư giãn không?",
            conv_id,
        )
        reply = (final.reply or "").lower()
        self.assertTrue(reply.strip())
        self.assertIn("minh", reply)
        self.assertTrue("lo-fi" in reply or "lofi" in reply)
        self.assertEqual(final.proposals, [])

    def test_crisis_escalation_reaches_guarded_terminal_response(self) -> None:
        user_id = f"mock_user_{uuid.uuid4().hex[:8]}"

        # Turn 1: Mild sadness
        first = self._post(
            user_id,
            "Mấy ngày nay mình hơi buồn và mất ngủ.",
        )
        conv_id = first.conversationId
        self.assertTrue((first.reply or "").strip())

        # Turn 2: Escalated despair
        second = self._post(
            user_id,
            "Mình cảm thấy tuyệt vọng hơn và không biết phải làm gì.",
            conv_id,
        )
        self.assertTrue((second.reply or "").strip())
        self.assertIn(second.type, ("answer", "crisis", "fallback", "no_answer"))
        # Crisis invariant: if turn 2 escalated to crisis, proposals must be empty
        if second.type == "crisis":
            self.assertEqual(second.suggestedActions, [])
            self.assertEqual(second.proposals, [])

        # Turn 3: Explicit acute crisis
        final = self._post(
            user_id,
            "Mình muốn tự tử ngay bây giờ.",
            conv_id,
        )
        self.assertEqual(final.type, "crisis")
        self.assertEqual(final.suggestedActions, [])
        self.assertEqual(final.proposals, [])
        self.assertTrue((final.reply or "").strip())

    def test_memory_is_scoped_to_user(self) -> None:
        owner_id = f"owner_{uuid.uuid4().hex[:8]}"
        other_id = f"other_{uuid.uuid4().hex[:8]}"

        # Owner shares identity & preferences
        self._post(
            owner_id,
            "Mình tên là Minh và mình thích nghe nhạc lo-fi.",
        )

        # Other user asks for their own identity & preference
        other_recall = self._post(
            other_id,
            "Bạn có biết tên và sở thích âm nhạc của mình không?",
        )
        other_reply = (other_recall.reply or "").lower()

        # Invariant: other user must NOT see owner's information
        self.assertNotIn("minh", other_reply)
        self.assertNotIn("lo-fi", other_reply)
        self.assertNotIn("lofi", other_reply)

    def test_repeatability_ten_consecutive_runs(self) -> None:
        """Verify that multi-turn tests pass reliably without flakiness."""
        for _ in range(10):
            self.setUp()
            self.test_support_conversation_preserves_context_across_turns()
            self.test_crisis_escalation_reaches_guarded_terminal_response()
            self.test_memory_is_scoped_to_user()


if __name__ == "__main__":
    unittest.main()
