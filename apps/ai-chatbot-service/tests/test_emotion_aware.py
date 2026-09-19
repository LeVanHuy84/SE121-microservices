"""Unit tests for Emotion-Aware Chatbot (Story 1.8)."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.chatbot.services.emotion_context import EmotionContextService, EmotionSnapshot
from app.modules.chatbot.services.prompt_builder import PromptBuilder


# ---------------------------------------------------------------------------
# EmotionSnapshot property tests
# ---------------------------------------------------------------------------

class TestEmotionSnapshot:
    def test_needs_empathetic_tone_true(self) -> None:
        s = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        assert s.needs_empathetic_tone is True

    def test_needs_empathetic_tone_high_risk(self) -> None:
        s = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        assert s.needs_empathetic_tone is True

    def test_needs_empathetic_tone_false_joy(self) -> None:
        s = EmotionSnapshot(primary_emotion="joy", risk_level="high")
        assert s.needs_empathetic_tone is False

    def test_needs_empathetic_tone_false_low_risk(self) -> None:
        s = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
        assert s.needs_empathetic_tone is False

    def test_needs_proactive_checkin_true(self) -> None:
        s = EmotionSnapshot(suggested_action="TRIGGER_PROACTIVE_CHECKIN")
        assert s.needs_proactive_checkin is True

    def test_needs_proactive_checkin_false(self) -> None:
        s = EmotionSnapshot(suggested_action="NO_ACTION")
        assert s.needs_proactive_checkin is False

    def test_default_snapshot_no_tone_no_checkin(self) -> None:
        s = EmotionSnapshot()
        assert s.needs_empathetic_tone is False
        assert s.needs_proactive_checkin is False


# ---------------------------------------------------------------------------
# EmotionContextService tests
# ---------------------------------------------------------------------------

class TestEmotionContextService:
    @pytest.fixture
    def service(self) -> EmotionContextService:
        return EmotionContextService()

    @pytest.mark.anyio
    async def test_returns_default_when_no_user_id(self, service: EmotionContextService) -> None:
        snapshot = await service.get_snapshot(None)
        assert snapshot.primary_emotion == "neutral"
        assert snapshot.risk_level == "none"

    @pytest.mark.anyio
    async def test_returns_default_when_user_id_empty(self, service: EmotionContextService) -> None:
        snapshot = await service.get_snapshot("")
        assert snapshot.primary_emotion == "neutral"

    @pytest.mark.anyio
    async def test_parses_emotion_doc_correctly(self, service: EmotionContextService) -> None:
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
                with patch.object(service, "_get_redis", return_value=None):
                    snapshot = await service._fetch("user123")

        assert snapshot.primary_emotion == "sadness"  # lowercase
        assert snapshot.risk_level == "medium"
        assert snapshot.suggested_action == "TRIGGER_PROACTIVE_CHECKIN"

    @pytest.mark.anyio
    async def test_returns_default_when_no_docs(self, service: EmotionContextService) -> None:
        mock_repo = AsyncMock()
        mock_repo.get_user_recent_analyses.return_value = []
        
        mock_lifespan = MagicMock()
        mock_lifespan.emotion_aggregate_repo = mock_repo

        with patch.dict("sys.modules", {"app.modules.analysis.lifespan": mock_lifespan}):
            with patch.object(service, "_get_redis", return_value=None):
                snapshot = await service._fetch("user123")

        assert snapshot.primary_emotion == "neutral"

    @pytest.mark.anyio
    async def test_fallback_on_exception(self, service: EmotionContextService) -> None:
        with patch.object(service, "_get_redis", return_value=None):
            with patch.object(service, "_fetch", side_effect=RuntimeError("DB down")):
                snapshot = await service.get_snapshot("user123")
        assert snapshot.primary_emotion == "neutral"
        assert snapshot.risk_level == "none"

    @pytest.mark.anyio
    async def test_get_snapshot_from_redis(self, service: EmotionContextService) -> None:
        mock_redis = AsyncMock()
        mock_redis.get.return_value = '{"primary_emotion": "fear", "risk_level": "high", "suggested_action": "TRIGGER_PROACTIVE_CHECKIN"}'
        
        with patch.object(service, "_get_redis", return_value=mock_redis):
            snapshot = await service.get_snapshot("user123")
            
        assert snapshot.primary_emotion == "fear"
        assert snapshot.risk_level == "high"
        mock_redis.get.assert_called_once_with("chatbot:emotion:user123")
# ---------------------------------------------------------------------------
# PromptBuilder tone directive tests
# ---------------------------------------------------------------------------

class TestPromptBuilderToneDirective:
    @pytest.fixture
    def builder(self) -> PromptBuilder:
        return PromptBuilder()

    def test_tone_directive_injected_for_sadness_medium(self, builder: PromptBuilder) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        directive = builder._build_emotion_tone_directive(snapshot)
        assert "TONE_DIRECTIVE" in directive
        assert "SADNESS" in directive
        assert "medium" in directive

    def test_tone_directive_injected_for_fear_high(self, builder: PromptBuilder) -> None:
        snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        directive = builder._build_emotion_tone_directive(snapshot)
        assert "TONE_DIRECTIVE" in directive

    def test_tone_directive_empty_for_joy(self, builder: PromptBuilder) -> None:
        snapshot = EmotionSnapshot(primary_emotion="joy", risk_level="high")
        directive = builder._build_emotion_tone_directive(snapshot)
        assert directive == ""

    def test_tone_directive_empty_for_none_snapshot(self, builder: PromptBuilder) -> None:
        directive = builder._build_emotion_tone_directive(None)
        assert directive == ""

    def test_tone_directive_socratic_for_low_risk(self, builder: PromptBuilder) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="weak")
        directive = builder._build_emotion_tone_directive(snapshot)
        assert "SOCRATES" in directive
        assert "câu hỏi mở" in directive


# ---------------------------------------------------------------------------
# System Prompt directive tests (Story 2.2)
# ---------------------------------------------------------------------------

class TestSystemPromptDirectives:
    """Verify that empathy, breathing, and medical prohibition directives
    are present in the system prompt (Story 2.1 / Story 2.2 validation)."""

    @pytest.fixture
    def builder(self) -> PromptBuilder:
        return PromptBuilder()

    @pytest.fixture
    def system_prompt(self, builder: PromptBuilder) -> str:
        return builder._build_system_prompt()

    def test_empathy_directive_present(self, system_prompt: str) -> None:
        """System prompt must instruct the bot to acknowledge emotions first."""
        assert "ĐỒNG CẢM" in system_prompt
        assert "lắng nghe" in system_prompt
        assert "xác nhận cảm xúc" in system_prompt

    def test_empathy_directive_before_advice(self, system_prompt: str) -> None:
        """Empathy section must appear before giving advice or information."""
        empathy_pos = system_prompt.find("ĐỒNG CẢM")
        advice_pos = system_prompt.find("câu hỏi mơ hồ")
        assert empathy_pos > advice_pos  # Empathy is added after base instructions

    def test_breathing_exercise_directive_present(self, system_prompt: str) -> None:
        """System prompt must contain the 4-7-8 breathing exercise instruction."""
        assert "4-7-8" in system_prompt
        assert "Hít vào" in system_prompt
        assert "Giữ hơi" in system_prompt
        assert "Thở ra" in system_prompt

    def test_breathing_exercise_seconds_correct(self, system_prompt: str) -> None:
        """The 4-7-8 technique must specify correct second counts."""
        assert "4 giây" in system_prompt
        assert "7 giây" in system_prompt
        assert "8 giây" in system_prompt

    def test_no_medical_diagnosis_directive_present(self, system_prompt: str) -> None:
        """System prompt must explicitly prohibit medical diagnoses."""
        assert "KHÔNG CHẨN ĐOÁN Y KHOA" in system_prompt
        assert "trầm cảm" in system_prompt  # Example of forbidden diagnosis language

    def test_no_diagnosis_suggests_professional(self, system_prompt: str) -> None:
        """When asked about mental health, bot must direct to professionals."""
        assert "chuyên gia tâm lý" in system_prompt

    def test_empathy_requires_open_ended_question(self, system_prompt: str) -> None:
        """When user is sad/anxious, bot must end with an open question."""
        assert "SOCRATES" in system_prompt
