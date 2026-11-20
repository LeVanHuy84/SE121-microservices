from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from app.modules.chatbot.schemas import AssistantRespondRequest
from app.modules.chatbot.services.embedding import EmbeddingService
from app.modules.chatbot.services.guardrails import (
    AssistantScopeGuard,
    CommunityGuard,
    CrisisGuard,
)
from app.modules.chatbot.services.guardrails_support.stage2_verifier import (
    Stage2GuardVerifier,
)
from app.modules.chatbot.services.rag_engine import RagDocumentService


class TestStage2HybridGuard(unittest.IsolatedAsyncioTestCase):
    async def test_venting_profanity_bypasses_community_guard_when_phobert_venting(
        self,
    ) -> None:
        text = "Dạo này công việc áp lực mệt vcl, không biết làm sao"
        comm_dec = CommunityGuard().evaluate(text)
        self.assertFalse(comm_dec.allowed)
        self.assertEqual(comm_dec.reason, "profanity_candidate")

        scope_dec = AssistantScopeGuard().evaluate_scope(
            AssistantRespondRequest(userId="u1", message=text)
        )
        crisis_dec = CrisisGuard().evaluate(text)

        verifier = Stage2GuardVerifier()
        verifier._centroids = {
            "mental_health": [1.0, 0.0],
            "system_guide": [0.0, 1.0],
            "implicit_crisis": [0.0, 0.0],
        }

        with (
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
                new=AsyncMock(return_value=[0.9, 0.1]),
            ),
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.phobert_moderator.infer_async",
                new=AsyncMock(
                    return_value={
                        "available": True,
                        "predicted_label": "PROFANITY_VENTING",
                        "all_scores": {
                            "CLEAN": 0.05,
                            "PROFANITY_VENTING": 0.72,
                            "HATE_SPEECH": 0.03,
                            "EMOTIONAL_CRISIS": 0.20,
                        },
                    }
                ),
            ),
        ):
            res = await verifier.verify_async(
                text,
                stage1_scope=scope_dec,
                stage1_community=comm_dec,
                stage1_crisis=crisis_dec,
            )

        self.assertTrue(res.community_allowed_override)
        self.assertEqual(res.distress_level, "mild_cbt")

    async def test_hate_speech_remains_blocked_when_score_high(self) -> None:
        text = "Đồ ngu dốt dm mày cút đi"
        comm_dec = CommunityGuard().evaluate(text)
        self.assertEqual(comm_dec.reason, "profanity_candidate")

        scope_dec = AssistantScopeGuard().evaluate_scope(
            AssistantRespondRequest(userId="u1", message=text)
        )
        crisis_dec = CrisisGuard().evaluate(text)

        verifier = Stage2GuardVerifier()
        verifier._centroids = {
            "mental_health": [1.0, 0.0],
            "system_guide": [0.0, 1.0],
            "implicit_crisis": [0.0, 0.0],
        }

        with (
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
                new=AsyncMock(return_value=[0.1, 0.1]),
            ),
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.phobert_moderator.infer_async",
                new=AsyncMock(
                    return_value={
                        "available": True,
                        "predicted_label": "HATE_SPEECH",
                        "all_scores": {
                            "CLEAN": 0.02,
                            "PROFANITY_VENTING": 0.10,
                            "HATE_SPEECH": 0.85,
                            "EMOTIONAL_CRISIS": 0.03,
                        },
                    }
                ),
            ),
        ):
            res = await verifier.verify_async(
                text,
                stage1_scope=scope_dec,
                stage1_community=comm_dec,
                stage1_crisis=crisis_dec,
            )

        self.assertFalse(res.community_allowed_override)

    async def test_grey_zone_query_promoted_by_centroid_cosine(self) -> None:
        text = "Tâm trạng mình dạo này cứ chông chênh thế nào ấy"
        scope_dec = AssistantScopeGuard().evaluate_scope(
            AssistantRespondRequest(userId="u1", message=text)
        )
        # Force a grey-zone Stage 1 decision (0.15 < confidence < 0.45)
        grey_scope = type(scope_dec)(
            in_scope=False,
            reason="out_of_scope",
            normalized_text=scope_dec.normalized_text,
            state="out_of_scope",
            confidence=0.25,
            matched_domains=(),
        )
        comm_dec = CommunityGuard().evaluate(text)
        crisis_dec = CrisisGuard().evaluate(text)

        verifier = Stage2GuardVerifier()
        verifier._centroids = {
            "mental_health": [1.0, 0.0],
            "system_guide": [0.0, 1.0],
            "implicit_crisis": [0.0, 0.0],
        }

        with (
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
                new=AsyncMock(return_value=[0.95, 0.05]),
            ),
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.phobert_moderator.infer_async",
                new=AsyncMock(
                    return_value={
                        "available": True,
                        "predicted_label": "CLEAN",
                        "all_scores": {
                            "CLEAN": 0.90,
                            "PROFANITY_VENTING": 0.02,
                            "HATE_SPEECH": 0.01,
                            "EMOTIONAL_CRISIS": 0.07,
                        },
                    }
                ),
            ),
        ):
            res = await verifier.verify_async(
                text,
                stage1_scope=grey_scope,
                stage1_community=comm_dec,
                stage1_crisis=crisis_dec,
            )

        self.assertTrue(res.in_scope_override)
        self.assertEqual(res.matched_domains_override, ("mental_health",))

    async def test_query_cache_reused_between_stage2_and_rag(self) -> None:
        svc = EmbeddingService()
        encode_spy = MagicMock(return_value=[[0.6, 0.8]])
        svc._encode = encode_spy  # type: ignore[method-assign]

        vec1 = await svc.encode_query_async("Mình đang lo lắng quá")
        vec2 = await svc.encode_query_async("Mình đang lo lắng quá")

        self.assertEqual(vec1, [0.6, 0.8])
        self.assertEqual(vec2, [0.6, 0.8])
        self.assertEqual(encode_spy.call_count, 1)

        # Verify RagDocumentService.search_assistant_docs uses the shared embedding_service cache
        mock_es = MagicMock()
        mock_es.indices = MagicMock()
        mock_es.indices.exists = AsyncMock(return_value=True)
        mock_es.search = AsyncMock(return_value={"hits": {"hits": []}})
        rag = RagDocumentService(es=mock_es)

        with patch("app.modules.chatbot.services.rag_engine.embedding_service", svc):
            await rag.search_assistant_docs("Mình đang lo lắng quá", top_k=3)

        self.assertEqual(encode_spy.call_count, 1)

    async def test_youth_slang_venting_profanity_routes_to_stage2_candidate(
        self,
    ) -> None:
        for slang_text in (
            "Áp lực công việc mệt vkl luôn á",
            "Hôm nay xui cmn quá, chán nản thật sự",
            "Deadline dí dkm mệt mỏi quá đi",
        ):
            comm_dec = CommunityGuard().evaluate(slang_text)
            self.assertFalse(comm_dec.allowed, slang_text)
            self.assertEqual(comm_dec.reason, "profanity_candidate", slang_text)

    def test_ambiguous_normal_phrases_not_blocked_by_stage1_guards(self) -> None:
        for normal_text in (
            "Mệt chết mất vì chạy deadline cả tuần",
            "Điên đầu vì bug mãi không sửa được, mọi thứ tệ quá",
        ):
            comm_dec = CommunityGuard().evaluate(normal_text)
            crisis_dec = CrisisGuard().evaluate(normal_text)
            self.assertTrue(comm_dec.allowed, normal_text)
            self.assertFalse(crisis_dec.is_crisis, normal_text)

    async def test_implicit_youth_slang_crisis_detected_by_stage2_centroid(
        self,
    ) -> None:
        text = "Mình muốn đăng xuất khỏi trái đất này cho nhẹ nợ"
        comm_dec = CommunityGuard().evaluate(text)
        scope_dec = AssistantScopeGuard().evaluate_scope(
            AssistantRespondRequest(userId="u1", message=text)
        )
        crisis_dec = CrisisGuard().evaluate(text)

        verifier = Stage2GuardVerifier()
        verifier._centroids = {
            "mental_health": [0.2, 0.0],
            "system_guide": [0.0, 1.0],
            "implicit_crisis": [1.0, 0.0],
        }

        with (
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
                new=AsyncMock(return_value=[0.95, 0.05]),
            ),
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.phobert_moderator.infer_async",
                new=AsyncMock(return_value={"available": False}),
            ),
        ):
            res = await verifier.verify_async(
                text,
                stage1_scope=scope_dec,
                stage1_community=comm_dec,
                stage1_crisis=crisis_dec,
            )

        self.assertEqual(res.distress_level, "acute_pfa")
        self.assertTrue(res.in_scope_override)
        self.assertEqual(res.matched_domains_override, ("mental_health",))

    async def test_verify_async_normalizes_query_with_normalize_query_text(
        self,
    ) -> None:
        text = "Mình buồn quá!"
        comm_dec = CommunityGuard().evaluate(text)
        scope_dec = AssistantScopeGuard().evaluate_scope(
            AssistantRespondRequest(userId="u1", message=text)
        )
        crisis_dec = CrisisGuard().evaluate(text)

        verifier = Stage2GuardVerifier()
        verifier._centroids = {
            "mental_health": [1.0, 0.0],
            "system_guide": [0.0, 1.0],
            "implicit_crisis": [0.0, 0.0],
        }
        encode_mock = AsyncMock(return_value=[1.0, 0.0])

        with (
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.embedding_service.encode_query_async",
                new=encode_mock,
            ),
            patch(
                "app.modules.chatbot.services.guardrails_support.stage2_verifier.phobert_moderator.infer_async",
                new=AsyncMock(return_value={"available": False}),
            ),
        ):
            await verifier.verify_async(
                text,
                stage1_scope=scope_dec,
                stage1_community=comm_dec,
                stage1_crisis=crisis_dec,
                effective_query="  Mình   buồn quá!  ",
            )

        encode_mock.assert_awaited_once_with("mình buồn quá!")
