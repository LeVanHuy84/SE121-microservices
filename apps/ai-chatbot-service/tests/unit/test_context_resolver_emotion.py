import unittest
from unittest.mock import MagicMock
from app.modules.chatbot.schemas import AssistantContextItem
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.context_resolver import AssistantContextResolver
from app.modules.chatbot.services.rag_engine import RagDocumentService


class TestContextResolverEmotion(unittest.TestCase):
    def test_emotion_aware_boosting(self):
        resolver = AssistantContextResolver()

        # Base items with same score
        contexts = [
            AssistantContextItem(
                id="1",
                type="help_doc",
                title="Sơ cứu tâm lý",
                content="PFA content",
                score=1.0,
                source="rag",
                metadata={"topic": "pfa"},
            ),
            AssistantContextItem(
                id="2",
                type="help_doc",
                title="Thở 4-7-8",
                content="CBT content",
                score=1.0,
                source="rag",
                metadata={"topic": "phuong-phap-chua-tri"},
            ),
            AssistantContextItem(
                id="3",
                type="help_doc",
                title="Đại cương",
                content="Academic",
                score=1.0,
                source="rag",
                metadata={"topic": "giao-trinh-chuyen-nganh"},
            ),
        ]

        # 1. High risk -> pfa boosted
        high_risk_snapshot = EmotionSnapshot(primary_emotion="fear", risk_level="high")
        ranked = resolver._rank_contexts(
            "test query",
            contexts,
            high_risk_snapshot,
            matched_domains=("mental_health",),
        )

        self.assertEqual(ranked[0].id, "1")  # PFA heavily boosted
        self.assertEqual(
            ranked[1].id, "2"
        )  # Phương pháp boosted slightly due to negative emotion
        self.assertEqual(ranked[2].id, "3")  # Giao trinh depressed

        # 2. Sadness but no risk -> phuong phap chua tri boosted
        sad_snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
        ranked2 = resolver._rank_contexts(
            "test query",
            contexts,
            sad_snapshot,
            matched_domains=("mental_health",),
        )

        self.assertEqual(ranked2[0].id, "2")  # CBT/self-care boosted
        self.assertEqual(ranked2[2].id, "3")  # Giao trinh depressed

        # 3. Neutral -> just lexical score
        neutral_snapshot = EmotionSnapshot(primary_emotion="neutral", risk_level="none")
        ranked3 = resolver._rank_contexts("test query", contexts, neutral_snapshot)

        # No emotion boost, fallback to original score/lexical
        self.assertEqual(len(ranked3), 3)

    def test_system_feature_turn_boosts_huong_dan_and_ignores_sadness(self):
        resolver = AssistantContextResolver()
        contexts = [
            AssistantContextItem(
                id="1",
                type="help_doc",
                title="Đổi mật khẩu",
                content="Vào cài đặt đổi pass",
                score=1.0,
                source="rag",
                metadata={"topic": "huong-dan"},
            ),
            AssistantContextItem(
                id="2",
                type="help_doc",
                title="Thở 4-7-8",
                content="Kỹ thuật thở",
                score=1.0,
                source="rag",
                metadata={"topic": "phuong-phap-chua-tri"},
            ),
            AssistantContextItem(
                id="3",
                type="help_doc",
                title="Sơ cứu tâm lý",
                content="PFA cơ bản",
                score=1.0,
                source="rag",
                metadata={"topic": "pfa"},
            ),
        ]
        sad_snapshot = EmotionSnapshot(primary_emotion="sadness", risk_level="none")
        # System turn with matched_domains=("settings_support", "auth")
        ranked = resolver._rank_contexts(
            "cách đổi mật khẩu",
            contexts,
            sad_snapshot,
            matched_domains=("settings_support", "auth"),
        )
        self.assertEqual(ranked[0].id, "1")  # huong-dan boosted by 1.4x
        self.assertAlmostEqual(ranked[0].score, 1.4, delta=0.35)

    def test_mixed_turn_boosts_huong_dan_and_pfa(self):
        resolver = AssistantContextResolver()
        contexts = [
            AssistantContextItem(
                id="1",
                type="help_doc",
                title="Chặn người dùng",
                content="Vào hồ sơ bấm chặn",
                score=1.0,
                source="rag",
                metadata={"topic": "huong-dan"},
            ),
            AssistantContextItem(
                id="2",
                type="help_doc",
                title="Sơ cứu tâm lý khẩn cấp",
                content="Ổn định cảm xúc",
                score=1.0,
                source="rag",
                metadata={"topic": "pfa"},
            ),
            AssistantContextItem(
                id="3",
                type="help_doc",
                title="Giáo trình tâm thần học",
                content="Lý thuyết",
                score=1.0,
                source="rag",
                metadata={"topic": "giao-trinh-chuyen-nganh"},
            ),
        ]
        # Mixed turn: user wants to block someone who harassed them (system + mental distress)
        ranked = resolver._rank_contexts(
            "người này quấy rối làm em hoảng loạn quá, làm sao chặn họ",
            contexts,
            None,
            matched_domains=("privacy", "mental_health"),
        )
        # In mixed turn: huong-dan is 1.4x, pfa is 1.35x, giao trinh is 0.75x
        top_ids = [item.id for item in ranked]
        self.assertIn("1", top_ids[:2])
        self.assertIn("2", top_ids[:2])
        self.assertEqual(ranked[-1].id, "3")

    def test_tier_ranking_actionable_worksheet_dominates_background_theory(self):
        resolver = AssistantContextResolver()
        contexts = [
            AssistantContextItem(
                id="theory-1",
                type="help_doc",
                title="Giáo trình CBT",
                content="Lý thuyết nhận thức hành vi",
                score=1.0,
                source="rag",
                metadata={
                    "tier": "background_theory",
                    "topic": "giao-trinh-chuyen-nganh",
                },
            ),
            AssistantContextItem(
                id="ref-1",
                type="help_doc",
                title="Sổ tay lâm sàng",
                content="Tham khảo lâm sàng",
                score=1.0,
                source="rag",
                metadata={"tier": "clinical_reference", "topic": "pfa"},
            ),
            AssistantContextItem(
                id="ws-1",
                type="help_doc",
                title="Hướng dẫn sơ cứu tâm lý",
                content="Thở 4-7-8 grounding",
                score=1.0,
                source="rag",
                metadata={"tier": "actionable_worksheet", "topic": "pfa"},
            ),
        ]
        ranked = resolver._rank_contexts(
            "mình đang hoảng loạn khó thở",
            contexts,
            EmotionSnapshot(),
            matched_domains=("mental_health",),
            distress_level="acute_pfa",
        )
        self.assertEqual(ranked[0].id, "ws-1")
        self.assertEqual(ranked[1].id, "ref-1")
        self.assertEqual(ranked[2].id, "theory-1")

    def test_decoupled_dense_vs_expanded_bm25_query(self):
        import asyncio
        from unittest.mock import AsyncMock, patch
        from app.modules.chatbot.schemas import AssistantRespondRequest

        resolver = AssistantContextResolver()
        mock_search = AsyncMock(return_value=[])

        async def _run():
            from app.core.settings import settings

            with (
                patch.object(settings, "RAG_DOCS_ENABLED", True),
                patch(
                    "app.modules.chatbot.services.rag_engine.rag_document_service.search_assistant_docs",
                    mock_search,
                ),
            ):
                await resolver.resolve(
                    AssistantRespondRequest(
                        userId="u1",
                        message="Mình đang hoảng loạn khó thở",
                    ),
                    emotion_snapshot=EmotionSnapshot(),
                    matched_domains=("mental_health",),
                    distress_level="acute_pfa",
                )

        asyncio.run(_run())
        mock_search.assert_awaited_once()
        call_args = mock_search.call_args
        dense_arg = call_args.args[0]
        bm25_kwarg = call_args.kwargs.get("bm25_query")
        self.assertEqual(dense_arg, "Mình đang hoảng loạn khó thở")
        self.assertIsNotNone(bm25_kwarg)
        self.assertIn("PFA", bm25_kwarg)

    def test_symptom_to_intervention_query_expansion(self):
        resolver = AssistantContextResolver()
        query = "dạo này em bị mất ngủ và lo âu quá"
        expanded = resolver._expand_mental_health_query(query, None)
        self.assertIn("pmr", expanded.lower())
        self.assertIn("cbt", expanded.lower())

        acute_query = "em đang bị hoảng loạn và khó thở"
        acute_expanded = resolver._expand_mental_health_query(acute_query, None)
        self.assertIn("breathing", acute_expanded.lower())
        self.assertIn("pfa", acute_expanded.lower())

    def test_bounded_lexical_score(self):
        resolver = AssistantContextResolver()
        long_query = "thử " * 50
        item = AssistantContextItem(
            id="1",
            type="help_doc",
            title="test",
            content="thử " * 50,
            score=1.0,
            source="rag",
        )
        score = resolver._compute_lexical_score(long_query, item)
        self.assertLessEqual(score, 0.30)
        self.assertGreaterEqual(score, 0.0)

    def test_rrf_merge_normalized_and_bounded(self):
        rag = RagDocumentService(es=MagicMock())
        # Empty lists return empty
        self.assertEqual(rag._rrf_merge([]), [])
        self.assertEqual(rag._rrf_merge([[], []]), [])

        # Non-empty ranked lists
        list1 = [
            {"_id": "doc1", "_source": {"title": "Doc 1"}},
            {"_id": "doc2", "_source": {"title": "Doc 2"}},
        ]
        list2 = [
            {"_id": "doc2", "_source": {"title": "Doc 2"}},
            {"_id": "doc3", "_source": {"title": "Doc 3"}},
        ]

        merged = rag._rrf_merge([list1, list2], k=60)
        self.assertEqual(len(merged), 3)
        # All hybrid scores must be strictly in (0.0, 1.0]
        for hit in merged:
            score = hit["_hybrid_score"]
            self.assertGreater(score, 0.0)
            self.assertLessEqual(score, 1.0)

        # doc2 was in both lists at high ranks, so it must be top ranked
        self.assertEqual(merged[0]["_id"], "doc2")

    def test_non_emotional_product_query_ignores_elevated_emotion_snapshot(self):
        from app.modules.chatbot.services.prompt_builder import PromptBuilder

        resolver = AssistantContextResolver()
        builder = PromptBuilder()
        elevated = EmotionSnapshot(
            primary_emotion="sadness",
            risk_level="high",
            persistent_distress=True,
        )
        self.assertFalse(
            resolver._is_mental_health_turn(
                "Sentimeta có những tính năng gì?",
                matched_domains=(),
                emotion_snapshot=elevated,
                distress_level="none",
            )
        )
        directive = builder._build_emotion_tone_directive(
            elevated,
            in_chat_distress=False,
            is_system_turn=False,
            distress_level="none",
            session_active_tier="NONE",
        )
        self.assertEqual(directive, "")
