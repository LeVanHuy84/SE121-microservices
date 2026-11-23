import unittest

from app.modules.chatbot.schemas import AssistantContextItem, SurfaceContext
from app.modules.chatbot.services.assistant_support.turn_mode import (
    TurnMode,
    TurnModeSignals,
    mode_prompt_directive,
    rag_tier_filter_for_mode,
    resolve_turn_mode,
)
from app.modules.chatbot.services.context_resolver import AssistantContextResolver
from app.modules.chatbot.tools.router import tool_router


class TestTurnModeGoldenRouting(unittest.TestCase):
    """Golden routing table verifying deterministic TurnMode classification without cross-bleeding."""

    def test_acute_pfa_always_wins_even_with_app_words(self):
        mode = resolve_turn_mode(
            TurnModeSignals(
                message="Mình hoảng loạn và tuyệt vọng quá, không có bạn bè nào để chia sẻ",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("mental_health", "user_social"),
                distress_level="acute_pfa",
                has_in_chat_distress=True,
            )
        )
        self.assertEqual(mode, TurnMode.MENTAL_HEALTH_PFA)
        self.assertNotIn("system_guide", rag_tier_filter_for_mode(mode) or ())

    def test_emotional_venting_with_bare_social_words_stays_mental_health_cbt(self):
        # Trap case: mentions "bạn bè" and "chia sẻ" inside emotional venting (no app intent)
        mode = resolve_turn_mode(
            TurnModeSignals(
                message="Mình cô đơn quá, không có bạn bè nào để chia sẻ nỗi buồn",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("mental_health", "user_social"),
                distress_level="mild_cbt",
                has_in_chat_distress=True,
            )
        )
        self.assertEqual(mode, TurnMode.MENTAL_HEALTH_CBT)
        self.assertNotIn("system_guide", rag_tier_filter_for_mode(mode) or ())

    def test_mixed_emotional_and_explicit_app_intent_routes_to_mixed_support_app(self):
        mode = resolve_turn_mode(
            TurnModeSignals(
                message="Hôm nay stress quá, gợi ý nhóm thiền cho mình với",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("mental_health", "group"),
                distress_level="mild_cbt",
                has_in_chat_distress=True,
            )
        )
        self.assertEqual(mode, TurnMode.MIXED_SUPPORT_APP)
        self.assertIsNone(rag_tier_filter_for_mode(mode))
        self.assertIn("MIXED_SUPPORT_APP", mode_prompt_directive(mode) or "")

        # ToolRouter must NOT suppress group tools on mixed_support_app
        tools = tool_router.route(
            SurfaceContext(screen="feed.home"),
            matched_domains=("mental_health", "group"),
            ai_policy="FULL",
            distress_level="mild_cbt",
            is_mental_health_turn=True,
            message="Hôm nay stress quá, gợi ý nhóm thiền cho mình với",
            turn_mode=mode.value,
        )
        self.assertIn("get_group_recommendations", [t.name for t in tools])

    def test_app_guide_and_user_data_separation(self):
        guide_mode = resolve_turn_mode(
            TurnModeSignals(
                message="Làm sao để kết bạn trên Sentimeta?",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("user_social",),
                has_howto_nav=True,
            )
        )
        self.assertEqual(guide_mode, TurnMode.APP_GUIDE)
        self.assertEqual(rag_tier_filter_for_mode(guide_mode), ("system_guide",))

        data_mode = resolve_turn_mode(
            TurnModeSignals(
                message="Xem lời mời kết bạn của tôi",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("user_social",),
            )
        )
        self.assertEqual(data_mode, TurnMode.USER_DATA)

        unknown_feature_mode = resolve_turn_mode(
            TurnModeSignals(
                message="Sentimeta có tính năng livestream 4K không?",
                scope_in_scope=False,
                scope_state="in_domain_unknown",
                matched_domains=("system",),
            )
        )
        self.assertEqual(unknown_feature_mode, TurnMode.APP_GUIDE)

    def test_app_guide_tool_suppression_for_pure_howto_only(self):
        # Pure how-to FAQ suppresses tools to save tokens and prevent accidental read calls
        howto_tools = tool_router.route(
            SurfaceContext(screen="settings.privacy"),
            matched_domains=("privacy", "settings_support"),
            ai_policy="FULL",
            is_system_turn=True,
            message="Làm sao để đổi ảnh đại diện trên Sentimeta?",
            turn_mode=TurnMode.APP_GUIDE.value,
        )
        self.assertEqual(howto_tools, [])

        # Non-howto APP_GUIDE status/account inquiry keeps tools
        status_tools = tool_router.route(
            SurfaceContext(screen="settings.privacy"),
            matched_domains=("privacy",),
            ai_policy="FULL",
            is_system_turn=True,
            message="Quyền riêng tư của mình đang là gì?",
            turn_mode=TurnMode.APP_GUIDE.value,
        )
        self.assertTrue(len(status_tools) > 0)

    def test_non_domain_turns_route_to_general_fallback_with_zero_tools_and_rag(self):
        # Both off-topic specialist tasks and everyday conversation (of any length)
        # share the same safe GENERAL_FALLBACK pipeline (RAG=[], tools=[], UTC+7 datetime)
        # so the 70B LLM distinguishes conversational warmth vs polite task refusal semantically.
        for msg in (
            "Giá vàng hôm nay bao nhiêu?",
            "Viết code Python sắp xếp mảng giúp mình",
            "How is the weather in Tokyo today?",
            "2 + 2 bằng mấy?",
            "Hôm nay thứ mấy?",
            "Hôm nay đi làm về gặp trời mưa to, ướt hết người xong về nhà nấu mì ăn một mình mà tự nhiên thấy trống trải ghê",
        ):
            with self.subTest(msg=msg):
                mode = resolve_turn_mode(
                    TurnModeSignals(
                        message=msg,
                        scope_in_scope=False,
                        scope_state="out_of_scope",
                        matched_domains=(),
                    )
                )
                self.assertEqual(mode, TurnMode.GENERAL_FALLBACK)
                self.assertEqual(rag_tier_filter_for_mode(mode), ())
                directive = mode_prompt_directive(mode) or ""
                self.assertIn("GENERAL_FALLBACK", directive)
                self.assertIn("giờ Việt Nam", directive)
                self.assertEqual(
                    tool_router.route(
                        SurfaceContext(screen="feed.home"),
                        matched_domains=(),
                        ai_policy="FULL",
                        turn_mode=mode.value,
                    ),
                    [],
                )

    def test_context_resolver_tier_isolation(self):
        resolver = AssistantContextResolver()
        docs = [
            AssistantContextItem(
                type="doc",
                id="guide-group-social",
                title="Hướng dẫn kết bạn",
                source="guide-group-social.md",
                content="Cách kết bạn trên Sentimeta",
            ),
            AssistantContextItem(
                type="doc",
                id="pfa-grounding-1",
                title="Kỹ thuật tiếp đất 5-4-3-2-1",
                source="pfa/grounding.md",
                content="Hít thở chậm và quan sát xung quanh",
            ),
        ]

        mh_only = resolver._filter_docs_by_tiers(
            docs, rag_tier_filter_for_mode(TurnMode.MENTAL_HEALTH_CBT) or ()
        )
        self.assertEqual([d.id for d in mh_only], ["pfa-grounding-1"])

        app_only = resolver._filter_docs_by_tiers(
            docs, rag_tier_filter_for_mode(TurnMode.APP_GUIDE) or ()
        )
        self.assertEqual([d.id for d in app_only], ["guide-group-social"])

    def test_rag_tier_filter_reads_metadata_tier_for_assistant_docs(self):
        resolver = AssistantContextResolver()
        docs = [
            AssistantContextItem(
                type="help_doc",
                id="post-guide:0",
                title="Hướng dẫn đăng bài",
                source="assistant_docs",
                content="Vào trang chủ để đăng bài",
                metadata={"tier": "system_guide", "topic": "huong-dan"},
            ),
            AssistantContextItem(
                type="help_doc",
                id="guide-self-care:0",
                title="Self Care Guide",
                source="assistant_docs",
                content="Bài tập hít thở 4-7-8",
                metadata={"tier": "actionable_worksheet", "topic": "phuong-phap-chua-tri"},
            ),
        ]

        app_only = resolver._filter_docs_by_tiers(
            docs, rag_tier_filter_for_mode(TurnMode.APP_GUIDE) or ()
        )
        self.assertEqual([d.id for d in app_only], ["post-guide:0"])

        mh_only = resolver._filter_docs_by_tiers(
            docs, rag_tier_filter_for_mode(TurnMode.MENTAL_HEALTH_CBT) or ()
        )
        self.assertEqual([d.id for d in mh_only], ["guide-self-care:0"])

    def test_faq_questions_do_not_trigger_action_policy_or_nav_hijack(self):
        from app.modules.chatbot.navigation.resolver import nav_resolver
        from app.modules.chatbot.services.assistant_support.proposals import (
            is_explicit_action_request,
        )
        from app.modules.chatbot.services.assistant_support.turn_mode import (
            is_user_data_query,
        )

        # CASE_APP_009: FAQ about unfriend notification must not be treated as action command
        self.assertFalse(
            is_explicit_action_request(
                "Hủy kết bạn với một người thì họ có nhận được thông báo không?"
            )
        )
        # Actual imperative command still detected
        self.assertTrue(is_explicit_action_request("Hủy kết bạn với Nam giúp tôi"))

        # CASE_APP_006: "bài đăng" must not match "ai dang" data retrieval indicator
        self.assertFalse(
            is_user_data_query(
                "Thấy có bài đăng chửi bậy thì làm sao để báo cho ban quản trị?",
                ("post",),
            )
        )

        # CASE_APP_010: conceptual criteria question must not be hijacked as nav command
        nav_decision = nav_resolver.resolve(
            "Sentimeta gợi ý bạn bè dựa trên tiêu chí gì vậy?"
        )
        self.assertEqual(nav_decision.path, "none")

        # CASE_APP_004: post + emotion domain without distress must stay APP_GUIDE, not MENTAL_HEALTH_CBT
        mode_app_004 = resolve_turn_mode(
            TurnModeSignals(
                message="Mình thả tim vào bài viết của bạn mình mà sao không thấy hiện?",
                scope_in_scope=True,
                scope_state="in_scope",
                matched_domains=("emotion", "post", "search"),
                distress_level="none",
            )
        )
        self.assertEqual(mode_app_004, TurnMode.APP_GUIDE)

    def test_restricted_policy_gate_blocks_data_retrieval_but_allows_howto(self):
        from unittest.mock import MagicMock

        from app.modules.chatbot.navigation.resolver import nav_resolver
        from app.modules.chatbot.schemas import AssistantRespondRequest
        from app.modules.chatbot.services.assistant_support.restricted_policy_gate import (
            evaluate_restricted_policy_gate,
        )

        mock_cmd = MagicMock()
        mock_cmd.nav_resolver = nav_resolver

        for blocked_query in (
            "Cho tôi biết danh sách bạn bè của tôi",
            "Liệt kê lời mời kết bạn",
            "Tôi có bao nhiêu thông báo chưa đọc?",
        ):
            with self.subTest(blocked_query=blocked_query):
                turn = evaluate_restricted_policy_gate(
                    mock_cmd,
                    AssistantRespondRequest(
                        userId="u1", message=blocked_query, aiPolicy="RESTRICTED"
                    ),
                    "conv-1",
                )
                self.assertIsNotNone(turn)
                self.assertTrue(turn.guard_data.policyBlocked)
                self.assertEqual(turn.guard_data.model, "policy-guard")

        # How-to FAQ under RESTRICTED must NOT be blocked
        howto_turn = evaluate_restricted_policy_gate(
            mock_cmd,
            AssistantRespondRequest(
                userId="u1",
                message="Làm sao để xem danh sách bạn bè?",
                aiPolicy="RESTRICTED",
            ),
            "conv-1",
        )
        self.assertIsNone(howto_turn)

    def test_domain_to_guide_doc_alignment_prefers_canonical_doc(self):
        resolver = AssistantContextResolver()
        chat_doc = AssistantContextItem(
            type="help_doc",
            id="guide-chat:1",
            title="Hướng dẫn Nhắn tin, Trò chuyện",
            source="assistant_docs",
            content="Cách tạo nhóm chat nhiều người trên Sentimeta",
            score=0.80,
            metadata={"docId": "guide-chat", "tier": "system_guide", "topic": "huong-dan"},
        )
        group_doc = AssistantContextItem(
            type="help_doc",
            id="guide-group-social:1",
            title="Hướng dẫn Quản lý Bạn bè và Nhóm",
            source="assistant_docs",
            content="Cách tạo nhóm cộng đồng mới trên Sentimeta",
            score=0.78,
            metadata={"docId": "guide-group-social", "tier": "system_guide", "topic": "huong-dan"},
        )
        ranked = resolver._rank_contexts(
            "Làm sao để tạo một nhóm mới trên Sentimeta?",
            [chat_doc, group_doc],
            matched_domains=("group",),
        )
        self.assertEqual(ranked[0].id, "guide-group-social:1")


if __name__ == "__main__":
    unittest.main()
