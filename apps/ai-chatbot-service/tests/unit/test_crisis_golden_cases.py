"""Golden test cases for Crisis Guardrails and Invariant Enforcement.

Verifies:
1. 100% detection rate on direct crisis expressions (self-harm, suicide).
2. 0% false positives for direct high-severity crisis on everyday stress/burnout.
3. Strict invariant enforcement on AssistantService:
   - When in crisis, type == "crisis"
   - suggestedActions == []
   - proposals == []
   - action is None
   - reply contains helpline resources
"""

from __future__ import annotations

import json
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, patch

from app.modules.chatbot.repositories.chat_history import (
    ChatHistoryRepository,
    HistoryStore,
)
from app.modules.chatbot.repositories.user_memory_profile import (
    UserMemoryProfileRepository,
)
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.assistant import AssistantService
from app.modules.chatbot.services.guardrails import CrisisGuard
from app.providers.stub_provider import StubLlmProvider
from tests.unit.test_chat_history_actions import FakeDb


FIXTURES_PATH = Path(__file__).parent.parent / "fixtures" / "crisis_golden_cases.json"


class TestCrisisGoldenCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(FIXTURES_PATH, "r", encoding="utf-8") as f:
            cls.fixtures = json.load(f)
        cls.guard = CrisisGuard()

    def test_direct_crisis_cases_100_percent_detected(self):
        direct_cases = self.fixtures["direct_crisis"]
        self.assertGreater(len(direct_cases), 0)

        for case in direct_cases:
            text = case["text"]
            with self.subTest(text=text):
                decision = self.guard.evaluate(text)
                self.assertTrue(
                    decision.is_crisis,
                    f"Direct crisis phrase failed detection: '{text}'",
                )
                self.assertEqual(
                    decision.severity,
                    case["expected_severity"],
                    f"Severity mismatch for '{text}': expected {case['expected_severity']}, got {decision.severity}",
                )

    def test_ambiguous_indirect_distress_detected(self):
        indirect_cases = self.fixtures["ambiguous_indirect_distress"]
        for case in indirect_cases:
            text = case["text"]
            with self.subTest(text=text):
                decision = self.guard.evaluate(text)
                # Indirect distress phrases must NOT trigger immediate Step 0 hard crisis
                # They are reserved for PhoBERT and empathetic PFA/CBT support
                self.assertFalse(
                    decision.is_crisis,
                    f"Indirect distress phrase should NOT short-circuit as hard crisis: '{text}'",
                )

    def test_non_crisis_sadness_burnout_zero_high_severity_false_positives(self):
        non_crisis_cases = self.fixtures["non_crisis_sadness_burnout"]
        for case in non_crisis_cases:
            text = case["text"]
            with self.subTest(text=text):
                decision = self.guard.evaluate(text)
                # It must NOT be flagged as high severity crisis
                self.assertNotEqual(
                    decision.severity,
                    "high",
                    f"Non-crisis phrase wrongly classified as high-severity crisis: '{text}'",
                )


class TestCrisisAssistantInvariants(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.db = FakeDb()
        self.repo = ChatHistoryRepository(db=self.db)
        self.history_store = HistoryStore(repository=self.repo)
        self.profile_repo = UserMemoryProfileRepository(db=self.db)
        self.stub_provider = StubLlmProvider()
        self.assistant = AssistantService(
            provider=self.stub_provider,
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
        )

    async def test_crisis_invariants_enforced_in_assistant_response(self):
        crisis_prompts = [
            "Mình muốn tự tử, mình không chịu nổi nữa",
            "I want to kill myself tonight",
            "Mình đang cắt tay chảy máu rất nhiều",
        ]

        with patch(
            "app.modules.chatbot.services.assistant.emit_crisis_event",
            new=AsyncMock(return_value=True),
        ):
            for prompt in crisis_prompts:
                with self.subTest(prompt=prompt):
                    req = AssistantRespondRequest(
                        userId="user-crisis-test",
                        message=prompt,
                    )
                    res = await self.assistant.respond(req)

                    # INVARIANTS:
                    # 1. Response type MUST be "crisis"
                    self.assertEqual(
                        res.type,
                        "crisis",
                        f"Expected type='crisis', got '{res.type}'",
                    )
                    # 2. suggestedActions MUST be empty
                    self.assertEqual(
                        res.suggestedActions,
                        [],
                        "suggestedActions must be strictly empty during crisis",
                    )
                    # 3. proposals MUST be empty
                    self.assertEqual(
                        res.proposals,
                        [],
                        "proposals must be strictly empty during crisis",
                    )
                    # 4. reply MUST NOT be empty and contain support hotlines
                    self.assertTrue(
                        len(res.reply.strip()) > 0,
                        "reply cannot be empty",
                    )
                    self.assertTrue(
                        "1900" in res.reply
                        or "988" in res.reply
                        or "115" in res.reply
                        or "111" in res.reply,
                        f"Crisis reply missing hotline numbers: '{res.reply}'",
                    )

    async def test_hybrid_crisis_uses_llm_empathy_with_hardcoded_hotlines(self):
        from app.core.settings import settings
        from app.providers.base import LlmGeneration

        class _EmpathyProvider:
            supports_chat_messages = True

            async def generate(self, prompt, request, **kwargs):
                return LlmGeneration(
                    content=(
                        "Mình nghe thấy bạn đang rất đau đớn và hoảng loạn lúc này. "
                        "Xin hãy đặt dao lam xuống và lùi vào nơi an toàn ngay bây giờ, sự an toàn của bạn là điều quan trọng nhất."
                    ),
                    model="test-llm",
                    provider="test",
                )

        assistant = AssistantService(
            provider=_EmpathyProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
        )
        with (
            patch.object(settings, "UNIT_TEST_MODE", False),
            patch.object(settings, "CHATBOT_LLM_STUB_MODE", False),
            patch(
                "app.modules.chatbot.services.assistant.emit_crisis_event",
                new=AsyncMock(return_value=True),
            ),
        ):
            res = await assistant.respond(
                AssistantRespondRequest(
                    userId="user-crisis-hybrid",
                    message="Mình đang cầm dao lam cắt tay chảy máu rất nhiều",
                )
            )
            self.assertEqual(res.type, "crisis")
            self.assertEqual(res.suggestedActions, [])
            self.assertEqual(res.proposals, [])
            self.assertIn("đặt dao lam xuống", res.reply)
            self.assertIn("1900 599 830", res.reply)
            self.assertIn("111", res.reply)
            self.assertIn("115", res.reply)

    async def test_hybrid_crisis_falls_back_to_static_template_on_llm_error(self):
        from app.core.settings import settings

        class _FailingProvider:
            supports_chat_messages = True

            async def generate(self, prompt, request, **kwargs):
                raise RuntimeError("429 Too Many Requests")

        assistant = AssistantService(
            provider=_FailingProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
        )
        with (
            patch.object(settings, "UNIT_TEST_MODE", False),
            patch.object(settings, "CHATBOT_LLM_STUB_MODE", False),
            patch(
                "app.modules.chatbot.services.assistant.emit_crisis_event",
                new=AsyncMock(return_value=False),
            ),
        ):
            res = await assistant.respond(
                AssistantRespondRequest(
                    userId="user-crisis-fallback",
                    message="Mình muốn tự tử, mình không chịu nổi nữa",
                )
            )
            self.assertEqual(res.type, "crisis")
            self.assertEqual(res.suggestedActions, [])
            self.assertIn("1900 599 830", res.reply)
            self.assertNotIn("Hệ thống đang chậm", res.reply)

    async def test_hybrid_crisis_rejects_fabricated_phone_numbers_and_falls_back(self):
        from app.core.settings import settings
        from app.providers.base import LlmGeneration

        class _FabricatedHotlineProvider:
            supports_chat_messages = True

            async def generate(self, prompt, request, **kwargs):
                return LlmGeneration(
                    content="Mình ở đây với bạn. Bạn hãy gọi số giả 0999888777 ngay nhé.",
                    model="test-llm",
                    provider="test",
                )

        assistant = AssistantService(
            provider=_FabricatedHotlineProvider(),
            history_store_instance=self.history_store,
            profile_repo=self.profile_repo,
        )
        with (
            patch.object(settings, "UNIT_TEST_MODE", False),
            patch.object(settings, "CHATBOT_LLM_STUB_MODE", False),
            patch(
                "app.modules.chatbot.services.assistant.emit_crisis_event",
                new=AsyncMock(return_value=False),
            ),
        ):
            res = await assistant.respond(
                AssistantRespondRequest(
                    userId="user-crisis-fake-num",
                    message="Mình muốn tự tử",
                )
            )
            self.assertEqual(res.type, "crisis")
            self.assertNotIn("0999888777", res.reply)
            self.assertIn("1900 599 830", res.reply)


if __name__ == "__main__":
    unittest.main()
