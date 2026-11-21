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


if __name__ == "__main__":
    unittest.main()
