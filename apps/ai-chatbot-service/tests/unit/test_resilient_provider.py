from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock

from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.assistant_support.turn_preparer import TurnPreparer
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.fact_extractor import FactExtractorService
from app.providers.base import LlmChunk, LlmGeneration
from app.providers.resilient_provider import (
    STREAM_TRUNCATION_NOTICE,
    CircuitOpenSkippedError,
    OpenAICompatibleFallbackProvider,
    ResilientLlmProvider,
)


class _RateLimitError(Exception):
    pass


class TestResilientProvider(unittest.IsolatedAsyncioTestCase):
    async def test_capability_detection_uses_build_messages_for_resilient_provider(
        self,
    ) -> None:
        provider = ResilientLlmProvider(
            primary=MagicMock(),
            fallback=OpenAICompatibleFallbackProvider(api_key=""),
        )
        self.assertTrue(getattr(provider, "supports_chat_messages", False))

        mock_cmd = MagicMock()
        mock_cmd.provider = provider
        mock_cmd.history_store = MagicMock()
        mock_cmd.history_store.resolve_conversation = AsyncMock(
            return_value={"id": "conv-1", "session_emotional_state": {}}
        )
        mock_cmd.history_store.load_context_window = AsyncMock(
            return_value=([], None, {})
        )
        mock_cmd.crisis_guard.evaluate.return_value = MagicMock(is_crisis=False)
        mock_cmd.community_guard.evaluate.return_value = MagicMock(
            allowed=True, reason="clean"
        )
        mock_cmd.nav_resolver.resolve.return_value = None
        mock_cmd.profile_repo.get_facts_by_user = AsyncMock(return_value={})
        mock_cmd.emotion_ctx.get_snapshot = AsyncMock(return_value=EmotionSnapshot())
        mock_cmd.scope_guard._normalize.return_value = "cach dang bai viet"
        mock_cmd.scope_guard.evaluate_scope.return_value = MagicMock(
            in_scope=True,
            state="in_scope",
            confidence=0.9,
            matched_domains=("post",),
            normalized_text="cach dang bai viet",
        )
        mock_cmd._resolve_follow_up_message = AsyncMock(
            return_value=("Cách đăng bài viết?", False)
        )
        mock_cmd._resolve_contexts_with_budget = AsyncMock(return_value=[])
        mock_cmd._dedupe_contexts.return_value = []
        mock_cmd.tool_router.get_openai_tools.return_value = []
        mock_cmd._supports_tools.return_value = False
        mock_cmd.prompt_builder.build_messages.return_value = ["msg1", "msg2"]

        preparer = TurnPreparer(mock_cmd)
        req = AssistantRespondRequest(userId="u1", message="Cách đăng bài viết?")
        turn = await preparer.prepare_turn(req, started_at=0.0, request_id="req-1")

        mock_cmd.prompt_builder.build_messages.assert_called_once()
        mock_cmd.prompt_builder.build.assert_not_called()
        self.assertEqual(turn.messages_or_prompt, ["msg1", "msg2"])

    async def test_pre_first_token_sse_failover_on_429(self) -> None:
        async def _primary_stream(*args, **kwargs):
            raise _RateLimitError("HTTP 429 rate limit exceeded")
            yield  # pragma: no cover

        async def _fallback_stream(*args, **kwargs):
            yield LlmChunk(
                content="Fallback ", model="gemini-2.5-flash", provider="gemini"
            )
            yield LlmChunk(content="OK", model="gemini-2.5-flash", provider="gemini")

        primary = MagicMock()
        primary.stream = _primary_stream
        fallback = MagicMock(spec=OpenAICompatibleFallbackProvider)
        fallback.is_enabled = True
        fallback.stream = _fallback_stream

        provider = ResilientLlmProvider(
            primary=primary,
            fallback=fallback,
            failure_threshold=3,
            cooldown_seconds=30.0,
        )
        req = AssistantRespondRequest(userId="u1", message="Xin chào")
        chunks = [c async for c in provider.stream("prompt", req)]

        self.assertEqual("".join(c.content for c in chunks), "Fallback OK")
        self.assertEqual(provider.circuit_state, "OPEN")

    async def test_mid_stream_failure_emits_truncation_notice_without_fallback(
        self,
    ) -> None:
        async def _primary_stream(*args, **kwargs):
            yield LlmChunk(content="Phần đầu ", model="llama", provider="groq")
            raise RuntimeError("Connection dropped mid-stream")

        fallback = MagicMock(spec=OpenAICompatibleFallbackProvider)
        fallback.is_enabled = True
        fallback.stream = MagicMock()

        primary = MagicMock()
        primary.stream = _primary_stream

        provider = ResilientLlmProvider(
            primary=primary,
            fallback=fallback,
            failure_threshold=1,
            cooldown_seconds=30.0,
        )
        req = AssistantRespondRequest(userId="u1", message="Xin chào")
        chunks = [c async for c in provider.stream("prompt", req)]

        full = "".join(c.content for c in chunks)
        self.assertIn("Phần đầu ", full)
        self.assertIn(STREAM_TRUNCATION_NOTICE, full)
        fallback.stream.assert_not_called()
        self.assertEqual(provider.circuit_state, "OPEN")

    async def test_fact_extractor_skips_when_circuit_open(self) -> None:
        primary = MagicMock()
        primary.generate = AsyncMock(
            return_value=LlmGeneration(
                content='{"set":{},"unset":[]}', model="m", provider="groq"
            )
        )
        fallback = MagicMock(spec=OpenAICompatibleFallbackProvider)
        fallback.is_enabled = True
        fallback.generate = AsyncMock()

        provider = ResilientLlmProvider(
            primary=primary,
            fallback=fallback,
            failure_threshold=1,
            cooldown_seconds=30.0,
        )
        provider._state = "OPEN"
        provider._opened_until = 9999999999.0

        req = AssistantRespondRequest(userId="u1", message="test")
        with self.assertRaises(CircuitOpenSkippedError):
            await provider.generate("prompt", req, allow_paid_fallback=False)

        fallback.generate.assert_not_called()

        mock_history_repo = MagicMock()
        mock_history_repo.is_conversation_active = AsyncMock(return_value=True)
        mock_profile_repo = MagicMock()
        mock_profile_repo.get_facts_by_user = AsyncMock(return_value={})
        mock_profile_repo.apply_fact_diff = AsyncMock()

        extractor = FactExtractorService(
            provider=provider,
            profile_repo=mock_profile_repo,
            history_repo=mock_history_repo,
        )
        await extractor._run_extraction(
            user_id="u1",
            conversation_id="conv-1",
            turn_count=1,
            last_user_message="Mình tên là An, đang làm kỹ sư phần mềm",
        )
        mock_profile_repo.apply_fact_diff.assert_not_called()
