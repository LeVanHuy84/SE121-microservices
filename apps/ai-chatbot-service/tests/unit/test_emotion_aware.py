"""Unit tests for Emotion-Aware Chatbot (Story 1.8)."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.emotion_context import (
    EmotionContextService,
    EmotionSnapshot,
)
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
        self.service._repo = mock_repo

        with patch(
            "app.modules.chatbot.services.emotion_context.asyncio.timeout",
            return_value=MagicMock(__aenter__=AsyncMock(), __aexit__=AsyncMock()),
        ):
            with patch.dict(
                "sys.modules", {"app.modules.analysis.lifespan": mock_lifespan}
            ):
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
        self.service._repo = mock_repo

        with patch.dict(
            "sys.modules", {"app.modules.analysis.lifespan": mock_lifespan}
        ):
            with patch.object(self.service, "_get_redis", return_value=None):
                snapshot = await self.service._fetch("user123")

        self.assertEqual(snapshot.primary_emotion, "neutral")

    async def test_fallback_on_exception(self) -> None:
        with patch.object(self.service, "_get_redis", return_value=None):
            with patch.object(
                self.service, "_fetch", side_effect=RuntimeError("DB down")
            ):
                snapshot = await self.service.get_snapshot("user123")
        self.assertEqual(snapshot.primary_emotion, "neutral")
        self.assertEqual(snapshot.risk_level, "none")

    async def test_persistent_distress_and_trend(self) -> None:
        mock_docs = [
            {"primaryEmotion": "sadness", "mentalHealthRiskLevel": "medium"},
            {"primaryEmotion": "anger", "mentalHealthRiskLevel": "none"},
            {"primaryEmotion": "joy", "mentalHealthRiskLevel": "none"},
        ]
        mock_repo = AsyncMock()
        mock_repo.get_user_recent_analyses.return_value = mock_docs
        self.service._repo = mock_repo

        with patch.object(self.service, "_get_redis", return_value=None):
            snapshot = await self.service._fetch("user_distressed")

        self.assertEqual(snapshot.primary_emotion, "sadness")
        self.assertTrue(snapshot.persistent_distress)

    async def test_positive_emotions_with_risk_level_are_not_persistent_distress(
        self,
    ) -> None:
        mock_docs = [
            {"primaryEmotion": "joy", "mentalHealthRiskLevel": "medium"},
            {"primaryEmotion": "neutral", "mentalHealthRiskLevel": "high"},
            {"primaryEmotion": "sadness", "mentalHealthRiskLevel": "none"},
        ]
        mock_repo = AsyncMock()
        mock_repo.get_user_recent_analyses.return_value = mock_docs

        with patch.object(self.service, "_get_redis", return_value=None):
            self.service._repo = mock_repo
            snapshot = await self.service._fetch("user_mixed")

        self.assertFalse(snapshot.persistent_distress)

    async def test_get_snapshot_from_redis(self) -> None:
        mock_pipe = MagicMock()
        mock_pipe.hgetall = MagicMock()
        mock_pipe.execute = AsyncMock(
            return_value=[
                {"acute_emotion": "fear", "acute_risk_level": "medium"},
                {
                    "hysteresis_risk_level": "HIGH_RISK",
                    "suggested_action": "MEDICAL_DOCUMENT",
                    "persistent_distress": "true",
                    "consecutive_negative_days": "4",
                },
            ]
        )
        mock_redis = MagicMock()
        mock_redis.pipeline.return_value = mock_pipe

        with patch.object(self.service, "_get_redis", return_value=mock_redis):
            snapshot = await self.service.get_snapshot("user123")

        self.assertEqual(snapshot.primary_emotion, "fear")
        self.assertEqual(snapshot.hysteresis_risk_level, "HIGH_RISK")
        self.assertEqual(snapshot.risk_level, "high")
        self.assertTrue(snapshot.persistent_distress)
        self.assertEqual(snapshot.consecutive_negative_days, 4)
        mock_pipe.hgetall.assert_any_call("chatbot:emotion:acute:user123")
        mock_pipe.hgetall.assert_any_call("emotion:longitudinal:user123")

    async def test_update_acute_cache_handles_wrongtype(self) -> None:
        pipe_fail = MagicMock()
        pipe_fail.hset = MagicMock()
        pipe_fail.expire = MagicMock()
        pipe_fail.execute = AsyncMock(
            side_effect=Exception(
                "WRONGTYPE Operation against a key holding the wrong kind of value"
            )
        )
        pipe_ok = MagicMock()
        pipe_ok.hset = MagicMock()
        pipe_ok.expire = MagicMock()
        pipe_ok.execute = AsyncMock(return_value=[1, True])

        mock_redis = MagicMock()
        mock_redis.pipeline.side_effect = [pipe_fail, pipe_ok]
        mock_redis.delete = AsyncMock(return_value=1)

        with patch.object(self.service, "_get_redis", return_value=mock_redis):
            await self.service.update_acute_cache("user123", "neutral", "low")

        mock_redis.delete.assert_awaited_once_with("chatbot:emotion:acute:user123")
        self.assertEqual(pipe_ok.execute.await_count, 1)


# ---------------------------------------------------------------------------
# PromptBuilder tone directive tests
# ---------------------------------------------------------------------------


class TestPromptBuilderToneDirective(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()

    def test_tier2_pfa_directive_on_acute_pfa_with_normal_baseline(self) -> None:
        normal_snapshot = EmotionSnapshot(
            primary_emotion="neutral",
            risk_level="none",
            hysteresis_risk_level="NORMAL",
        )
        directive = self.builder._build_emotion_tone_directive(
            normal_snapshot,
            in_chat_distress=True,
            is_system_turn=False,
            distress_level="acute_pfa",
        )
        self.assertIn("TIER 2", directive)
        self.assertIn("TUYỆT ĐỐI KHÔNG", directive)

    def test_tone_directive_injected_for_sadness_medium(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
        self.assertIn("TONE_DIRECTIVE", directive)
        self.assertIn("SADNESS", directive)
        self.assertIn("medium", directive)

    def test_tone_directive_injected_for_fear_high(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
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
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
        self.assertIn("SOCRATES", directive)
        self.assertIn("câu hỏi mở", directive)

    def test_persistent_distress_with_joy_primary_does_not_mislabel_emotion(
        self,
    ) -> None:
        snapshot = EmotionSnapshot(
            primary_emotion="joy",
            risk_level="weak",
            persistent_distress=True,
        )
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
        self.assertIn("TONE_DIRECTIVE", directive)
        self.assertNotIn("JOY", directive)
        self.assertIn("kéo dài", directive)

    def test_tone_directive_includes_persistent_distress(self) -> None:
        snapshot = EmotionSnapshot(
            primary_emotion="sadness",
            risk_level="medium",
            persistent_distress=True,
        )
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
        self.assertIn("kéo dài", directive)
        self.assertIn("thở 4-7-8", directive)


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


class TestToneIsolationAndPolicy(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()

    def test_non_distress_turn_suppresses_tone_directive_even_with_snapshot(
        self,
    ) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="high")
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=False
        )
        self.assertEqual(directive, "")

    def test_system_turn_suppresses_tone_directive(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="high")
        directive = self.builder._build_emotion_tone_directive(
            snapshot,
            in_chat_distress=False,
            is_system_turn=True,
            session_active_tier="TIER_2_PFA",
        )
        self.assertEqual(directive, "")

    def test_restricted_policy_strips_personal_memory_and_emotion(self) -> None:
        snapshot = EmotionSnapshot(
            primary_emotion="sadness",
            risk_level="high",
            chatbot_prompt_context="Secret context",
        )
        request = AssistantRespondRequest(
            userId="user1",
            message="Cài đặt riêng tư ở đâu?",
            aiPolicy="RESTRICTED",
        )
        prompt = self.builder.build(
            request,
            history=[],
            user_facts=["Likes jazz"],
            memory_summary="User talked about family",
            emotion_snapshot=snapshot,
            in_chat_distress=False,
        )
        self.assertNotIn("Likes jazz", prompt)
        self.assertNotIn("User talked about family", prompt)
        self.assertNotIn("Secret context", prompt)
        self.assertNotIn("TONE_DIRECTIVE:", prompt)


class TestSteppedCareAndPromptLimits(unittest.TestCase):
    def setUp(self) -> None:
        self.builder = PromptBuilder()

    def test_system_prompt_has_no_inline_action_json(self) -> None:
        sys_prompt = self.builder._build_system_prompt()
        self.assertNotIn("```action", sys_prompt)
        self.assertNotIn("```json:action", sys_prompt)

    def test_tier2_acute_pfa_mode_directive(self) -> None:
        snapshot = EmotionSnapshot(
            primary_emotion="fear",
            risk_level="high",
            persistent_distress=True,
        )
        directive = self.builder._build_emotion_tone_directive(
            snapshot, in_chat_distress=True
        )
        self.assertIn("TONE_DIRECTIVE (TIER 2 - SƠ CỨU TÂM LÝ PFA)", directive)
        self.assertIn("thở 4-7-8", directive)
        self.assertIn("TUYỆT ĐỐI KHÔNG", directive)

    def test_tier3_in_chat_distress_without_snapshot(self) -> None:
        directive = self.builder._build_emotion_tone_directive(
            None,
            in_chat_distress=True,
            is_system_turn=False,
        )
        self.assertIn("PHƯƠNG PHÁP SOCRATES & CBT NHẸ NHÀNG", directive)
        self.assertIn("câu hỏi mở", directive)

    def test_system_turn_suppresses_emotion_directive(self) -> None:
        snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="medium")
        directive = self.builder._build_emotion_tone_directive(
            snapshot,
            in_chat_distress=False,
            is_system_turn=True,
        )
        self.assertEqual(directive, "")

    def test_build_messages_structure_and_limits(self) -> None:
        from app.modules.chatbot.schemas import AssistantHistoryItem

        req = AssistantRespondRequest(
            userId="user1", message="Làm sao giải tỏa căng thẳng?"
        )
        hist = [
            AssistantHistoryItem(role="user", content="Turn 1" * 100),
            AssistantHistoryItem(role="assistant", content="Reply 1" * 100),
            AssistantHistoryItem(role="user", content="Turn 2" * 100),
            AssistantHistoryItem(role="assistant", content="Reply 2" * 100),
        ]
        msgs = self.builder.build_messages(
            req,
            hist,
            max_history_items=2,
            history_item_char_limit=50,
            in_chat_distress=True,
        )
        # Should have SystemMessage, 2 history messages, HumanMessage
        self.assertEqual(len(msgs), 4)
        from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

        self.assertIsInstance(msgs[0], SystemMessage)
        self.assertIsInstance(msgs[1], HumanMessage)
        self.assertIsInstance(msgs[2], AIMessage)
        self.assertIsInstance(msgs[3], HumanMessage)

        # Truncation check (50 + "...")
        self.assertTrue(msgs[1].content.endswith("..."))
        self.assertLessEqual(len(msgs[1].content), 53)
        self.assertTrue(msgs[2].content.endswith("..."))
        self.assertLessEqual(len(msgs[2].content), 53)
        self.assertIn("Làm sao giải tỏa căng thẳng?", msgs[3].content)


class TestSessionEmotionalStatePersistence(unittest.IsolatedAsyncioTestCase):
    async def test_short_followup_inherits_tier2_pfa_and_decrements_ttl(self) -> None:
        from app.modules.chatbot.services.assistant_support.turn_preparer import (
            TurnPreparer,
        )

        mock_cmd = MagicMock()
        mock_cmd.context_resolver._is_system_turn.return_value = False
        mock_cmd.context_resolver._is_mental_health_turn.return_value = True
        mock_cmd.provider = MagicMock(supports_chat_messages=True)
        mock_cmd.history_store = MagicMock()
        mock_cmd.history_store.resolve_conversation = AsyncMock(
            return_value={
                "id": "conv-1",
                "session_emotional_state": {
                    "active_tier": "TIER_2_PFA",
                    "remaining_turns_ttl": 3,
                    "topic_anchor": "Mình đang hoảng loạn tim đập nhanh khó thở",
                },
            }
        )
        mock_cmd.history_store.load_context_window = AsyncMock(
            return_value=([], None, {})
        )
        mock_cmd.crisis_guard.evaluate.return_value = MagicMock(is_crisis=False)
        mock_cmd.community_guard.evaluate.return_value = MagicMock(
            allowed=True, reason="clean"
        )
        mock_cmd.nav_resolver.resolve.return_value = None
        mock_cmd._emit_crisis_event = AsyncMock(return_value=False)
        mock_cmd.profile_repo.get_facts_by_user = AsyncMock(return_value={})
        mock_cmd.emotion_ctx.get_snapshot = AsyncMock(return_value=EmotionSnapshot())
        mock_cmd.scope_guard._normalize.return_value = (
            "minh thu tho cham roi ma van chua do"
        )
        mock_cmd.scope_guard.evaluate_scope.return_value = MagicMock(
            in_scope=False,
            state="out_of_scope",
            confidence=0.10,
            matched_domains=(),
            normalized_text="minh thu tho cham roi ma van chua do",
        )
        mock_cmd._resolve_follow_up_message = AsyncMock(
            return_value=("Mình thử thở chậm rồi mà vẫn chưa đỡ", False)
        )
        mock_cmd._resolve_contexts_with_budget = AsyncMock(return_value=[])
        mock_cmd._dedupe_contexts.return_value = []
        mock_cmd.tool_router.get_openai_tools.return_value = []
        mock_cmd._supports_tools.return_value = False
        mock_cmd.prompt_builder.build_messages.return_value = ["msg"]

        preparer = TurnPreparer(mock_cmd)
        req = AssistantRespondRequest(
            userId="u1", message="Mình thử thở chậm rồi mà vẫn chưa đỡ"
        )
        with patch(
            "app.modules.chatbot.services.assistant_support.turn_preparer.stage2_guard_verifier.verify_async",
            new=AsyncMock(return_value=None),
        ):
            turn = await preparer.prepare_turn(req, started_at=0.0, request_id="req-1")

        self.assertEqual(turn.distress_level, "acute_pfa")
        self.assertTrue(turn.in_chat_distress)
        self.assertEqual(turn.session_emotional_state["active_tier"], "TIER_2_PFA")
        self.assertEqual(turn.session_emotional_state["remaining_turns_ttl"], 2)
        mock_cmd._resolve_contexts_with_budget.assert_awaited_once()
        self.assertEqual(
            mock_cmd._resolve_contexts_with_budget.call_args.kwargs.get("topic_anchor"),
            "Mình đang hoảng loạn tim đập nhanh khó thở",
        )

    def test_positive_recovery_cue_ignores_thanks_with_continuation(self) -> None:
        from app.modules.chatbot.services.assistant_support.turn_preparer import (
            _is_positive_recovery_cue,
        )

        self.assertFalse(
            _is_positive_recovery_cue("Cảm ơn bạn, nhưng mình vẫn còn hơi ngộp")
        )
        self.assertTrue(_is_positive_recovery_cue("Cảm ơn bạn nhiều"))
        self.assertTrue(_is_positive_recovery_cue("Mình ổn rồi, cảm ơn bạn"))

    async def test_get_snapshot_is_read_only_on_longitudinal_miss(self) -> None:
        svc = EmotionContextService()
        mock_pipe = MagicMock()
        mock_pipe.hgetall = MagicMock()
        mock_pipe.execute = AsyncMock(return_value=[{}, {}])
        mock_redis = MagicMock()
        mock_redis.pipeline.return_value = mock_pipe

        svc._get_redis = MagicMock(return_value=mock_redis)
        svc._fetch = AsyncMock(return_value=EmotionSnapshot())
        svc.update_longitudinal_cache = AsyncMock()

        snap = await svc.get_snapshot("user-miss-1")

        self.assertEqual(snap.hysteresis_risk_level, "NORMAL")
        svc.update_longitudinal_cache.assert_not_awaited()
