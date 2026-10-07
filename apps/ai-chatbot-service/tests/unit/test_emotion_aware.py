"""Unit tests for Emotion-Aware Chatbot (Story 1.8)."""
from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.emotion_context import EmotionContextService, EmotionSnapshot
from app.modules.chatbot.services.prompt_builder import PromptBuilder


# ---------------------------------------------------------------------------
# EmotionSnapshot property tests
# ---------------------------------------------------------------------------

class TestEmotionSnapshot(unittest.TestCase):
    def test_needs_empathetic_tone_true(self) -> None:
        s = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        self.assertTrue(s.needs_empathetic_tone)

    def test_needs_empathetic_tone_high_risk(self) -> None:
        s = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        self.assertTrue(s.needs_empathetic_tone)

    def test_needs_empathetic_tone_false_joy(self) -> None:
        s = EmotionSnapshot(primary_emotion="joy", risk_level="high")
        self.assertFalse(s.needs_empathetic_tone)

    def test_needs_empathetic_tone_false_low_risk(self) -> None:
        s = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
        self.assertFalse(s.needs_empathetic_tone)

    def test_needs_proactive_checkin_true(self) -> None:
        s = EmotionSnapshot(suggested_action="TRIGGER_PROACTIVE_CHECKIN")
        self.assertTrue(s.needs_proactive_checkin)

    def test_needs_proactive_checkin_false(self) -> None:
        s = EmotionSnapshot(suggested_action="NO_ACTION")
        self.assertFalse(s.needs_proactive_checkin)

    def test_default_snapshot_no_tone_no_checkin(self) -> None:
        s = EmotionSnapshot()
        self.assertFalse(s.needs_empathetic_tone)
        self.assertFalse(s.needs_proactive_checkin)


# ---------------------------------------------------------------------------
# EmotionContextService tests
# ---------------------------------------------------------------------------

class TestEmotionContextService(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.service = EmotionContextService()

    async def test_returns_default_when_no_user_id(self) -> None:
        snapshot = await self.service.get_snapshot(None)
        self.assertEqual(snapshot.primary_emotion, "neutral")
        self.assertEqual(snapshot.risk_level, "none")

    async def test_returns_default_when_user_id_empty(self) -> None:
        snapshot = await self.service.get_snapshot("")
        self.assertEqual(snapshot.primary_emotion, "neutral")

    async def test_parses_emotion_doc_correctly(self) -> None:
        mock_doc = {
            "primaryEmotion": "Sadness",
            "mentalHealthRiskLevel": "medium",
            "suggestedAction": "TRIGGER_PROACTIVE_CHECKIN",
        }
        mock_repo = AsyncMock()
        mock_repo.get_user_recent_analyses.return_value = [mock_doc]

        mock_lifespan = MagicMock()
        mock_lifespan.emotion_aggregate_repo = mock_repo

        with patch("app.modules.chatbot.services.emotion_context.asyncio.timeout", return_value=MagicMock(__aenter__=AsyncMock(), __aexit__=AsyncMock())):
            with patch.dict("sys.modules", {"app.modules.analysis.lifespan": mock_lifespan}):
                with patch.object(self.service, "_get_redis", return_value=None):
                    snapshot = await self.service._fetch("user123")

        self.assertEqual(snapshot.primary_emotion, "sadness")  # lowercase
        self.assertEqual(snapshot.risk_level, "medium")
        self.assertEqual(snapshot.suggested_action, "TRIGGER_PROACTIVE_CHECKIN")

    async def test_returns_default_when_no_docs(self) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_user_recent_analyses.return_value = []

        mock_lifespan = MagicMock()
        mock_lifespan.emotion_aggregate_repo = mock_repo

        with patch.dict("sys.modules", {"app.modules.analysis.lifespan": mock_lifespan}):
            with patch.object(self.service, "_get_redis", return_value=None):
                snapshot = await self.service._fetch("user123")

        self.assertEqual(snapshot.primary_emotion, "neutral")

    async def test_fallback_on_exception(self) -> None:
        with patch.object(self.service, "_get_redis", return_value=None):
            with patch.object(self.service, "_fetch", side_effect=RuntimeError("DB down")):
                snapshot = await self.service.get_snapshot("user123")
        self.assertEqual(snapshot.primary_emotion, "neutral")
        self.assertEqual(snapshot.risk_level, "none")

    async def test_get_snapshot_from_redis(self) -> None:
        mock_redis = AsyncMock()
        mock_redis.get.return_value = '{"primary_emotion": "fear", "risk_level": "high", "suggested_action": "TRIGGER_PROACTIVE_CHECKIN"}'

        with patch.object(self.service, "_get_redis", return_value=mock_redis):
            snapshot = await self.service.get_snapshot("user123")

        self.assertEqual(snapshot.primary_emotion, "fear")
        self.assertEqual(snapshot.risk_level, "high")
        mock_redis.get.assert_called_once_with("chatbot:emotion:user123")


# ---------------------------------------------------------------------------
# PromptBuilder tone directive tests
# ---------------------------------------------------------------------------

class TestPromptBuilderToneDirective(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()

    def test_tone_directive_injected_for_sadness_medium(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        directive = self.builder._build_emotion_tone_directive(snapshot)
        self.assertIn("TONE_DIRECTIVE", directive)
        self.assertIn("SADNESS", directive)
        self.assertIn("medium", directive)

    def test_tone_directive_injected_for_fear_high(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        directive = self.builder._build_emotion_tone_directive(snapshot)
        self.assertIn("TONE_DIRECTIVE", directive)

    def test_tone_directive_empty_for_joy(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="joy", risk_level="high")
        directive = self.builder._build_emotion_tone_directive(snapshot)
        self.assertEqual(directive, "")

    def test_tone_directive_empty_for_none_snapshot(self) -> None:
        directive = self.builder._build_emotion_tone_directive(None)
        self.assertEqual(directive, "")

    def test_tone_directive_socratic_for_low_risk(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="weak")
        directive = self.builder._build_emotion_tone_directive(snapshot)
        self.assertIn("SOCRATES", directive)
        self.assertIn("câu hỏi mở", directive)


# ---------------------------------------------------------------------------
# System Prompt directive tests (Story 2.2)
# ---------------------------------------------------------------------------

class TestSystemPromptDirectives(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()
        self.system_prompt = self.builder._build_system_prompt()

    def test_empathy_directive_present(self) -> None:
        self.assertIn("ĐỒNG CẢM", self.system_prompt)
        self.assertIn("lắng nghe", self.system_prompt)
        self.assertIn("xác nhận cảm xúc", self.system_prompt)

    def test_empathy_directive_before_advice(self) -> None:
        empathy_pos = self.system_prompt.find("ĐỒNG CẢM")
        advice_pos = self.system_prompt.find("câu hỏi mơ hồ")
        self.assertGreater(empathy_pos, advice_pos)

    def test_breathing_exercise_directive_present(self) -> None:
        self.assertIn("4-7-8", self.system_prompt)
        self.assertIn("Hít vào", self.system_prompt)
        self.assertIn("Giữ hơi", self.system_prompt)
        self.assertIn("Thở ra", self.system_prompt)

    def test_breathing_exercise_seconds_correct(self) -> None:
        self.assertIn("4 giây", self.system_prompt)
        self.assertIn("7 giây", self.system_prompt)
        self.assertIn("8 giây", self.system_prompt)

    def test_no_medical_diagnosis_directive_present(self) -> None:
        self.assertIn("KHÔNG CHẨN ĐOÁN Y KHOA", self.system_prompt)
        self.assertIn("trầm cảm", self.system_prompt)

    def test_no_diagnosis_suggests_professional(self) -> None:
        self.assertIn("chuyên gia tâm lý", self.system_prompt)

    def test_empathy_requires_open_ended_question(self) -> None:
        self.assertIn("SOCRATES", self.system_prompt)


class TestProactiveCheckin(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()

    def test_proactive_checkin_directive_injected(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        request = AssistantRespondRequest(userId="user1", message="")
        prompt = self.builder.build(
            request,
            history=[],
            emotion_snapshot=snapshot,
            is_proactive_checkin=True,
        )
        self.assertIn("HÃY CHỦ ĐỘNG GỬI LỜI CHÀO", prompt)
        self.assertIn("sadness", prompt)

    def test_proactive_checkin_directive_with_chatbot_context(self) -> None:
        snapshot = EmotionSnapshot(
            primary_emotion="sadness",
            risk_level="medium",
            chatbot_prompt_context="Hãy khuyên người dùng nghe bản nhạc thư giãn A.",
        )
        request = AssistantRespondRequest(userId="user1", message="")
        prompt = self.builder.build(
            request,
            history=[],
            emotion_snapshot=snapshot,
            is_proactive_checkin=True,
        )
        self.assertIn("Hãy khuyên người dùng nghe bản nhạc thư giãn A.", prompt)
        self.assertNotIn("Gần đây hệ thống nhận thấy người dùng đang có dấu hiệu", prompt)
