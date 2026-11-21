import unittest
from uuid import UUID

from app.modules.chatbot.schemas import (
    AssistantRespondRequest,
    SurfaceContext,
)
from app.modules.chatbot.services.assistant import RespondCommand
from app.modules.chatbot.tools.dispatcher import ToolExecutionResult


class AssistantProposalSynthesisTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.cmd = RespondCommand()

    async def test_crisis_guard_precedence_suppresses_all_proposals(self):
        req = AssistantRespondRequest(
            userId="u-crisis-1",
            message="Tôi muốn chết, hãy kết bạn với tôi và đọc hết thông báo đi",
        )
        resp = await self.cmd.execute(req)
        self.assertEqual(resp.type, "crisis")
        self.assertEqual(len(resp.proposals), 0)
        self.assertEqual(len(resp.suggestedActions), 0)
        self.assertEqual(len(resp.cards), 0)

    def test_extract_proposals_from_llm_reply_valid(self):
        reply = (
            "Tôi có thể đánh dấu tất cả thông báo là đã đọc.\n"
            "```action\n"
            '{"actionName": "mark_all_notifications_read", "title": "Đánh dấu đã đọc", "description": "Đánh dấu toàn bộ thông báo là đã đọc", "params": {}}\n'
            "```\n"
            "Vui lòng nhấn nút xác nhận bên dưới nhé!"
        )
        cleaned_reply, proposals = self.cmd._extract_proposals_from_llm_reply(
            reply,
            user_id="u-1",
            conversation_id="conv-1",
            ai_policy="FULL",
        )

        self.assertEqual(len(proposals), 1)
        prop = proposals[0]
        self.assertEqual(prop.type, "propose_action")
        self.assertEqual(prop.payload.actionName, "mark_all_notifications_read")
        self.assertEqual(prop.payload.params, {})
        self.assertEqual(prop.payload.title, "Đánh dấu đã đọc")
        self.assertTrue(UUID(prop.payload.idempotencyKey))
        self.assertNotIn("```action", cleaned_reply)
        self.assertIn("Tôi có thể đánh dấu tất cả thông báo là đã đọc.", cleaned_reply)
        self.assertIn("Vui lòng nhấn nút xác nhận bên dưới nhé!", cleaned_reply)

    def test_extract_proposals_rejects_non_allowlisted_action(self):
        for action_name in ("delete_database", "send_friend_request", "block_user"):
            reply = f'```action\n{{"actionName": "{action_name}", "params": {{}}}}\n```\n'
            cleaned, proposals = self.cmd._extract_proposals_from_llm_reply(
                reply, ai_policy="FULL"
            )
            self.assertEqual(len(proposals), 0)
            self.assertNotIn("```action", cleaned)

    def test_detect_action_proposals_mark_notifications_read(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Đọc hết thông báo giúp tôi",
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "mark_all_notifications_read")
        self.assertEqual(proposals[0].payload.params, {})
        self.assertTrue(UUID(proposals[0].payload.idempotencyKey))

    def test_detect_action_proposals_zero_guesswork_for_social_and_group_requests(self):
        """Social/group requests must NEVER synthesize ProposeAction; they use Interactive Mini Cards."""
        class DummyTC:
            name = "search_users"

        dummy_res = ToolExecutionResult(
            tool_name="search_users",
            success=True,
            data={
                "users": [
                    {"id": "u-nam-1", "name": "Hoàng Nam", "username": "nam1", "avatarUrl": "https://cdn/1.png"},
                    {"id": "u-nam-2", "name": "Hoàng Nam", "username": "nam2", "avatarUrl": "https://cdn/2.png"},
                ]
            },
        )
        for msg in (
            "Gửi kết bạn cho Hoàng Nam đi",
            "Chấp nhận lời mời kết bạn của Nam",
            "Từ chối lời mời kết bạn của Nam",
            "Hủy kết bạn với Hoàng Nam",
            "Chặn Hoàng Nam giúp tôi",
            "Cho mình tham gia nhóm với",
            "Rời nhóm này giúp mình",
            "Thả tim bài viết này giúp mình",
        ):
            with self.subTest(msg=msg):
                req = AssistantRespondRequest(
                    userId="u-1",
                    conversationId="conv-1",
                    aiPolicy="FULL",
                    message=msg,
                    surface=SurfaceContext(
                        screen="social.profile",
                        entityId="u-nam-1",
                        metadata={"userName": "Hoàng Nam"},
                    ),
                )
                self.assertEqual(
                    self.cmd._detect_action_proposals(req, (DummyTC(),), [dummy_res]),
                    [],
                )

        # Meanwhile, extract_cards emits Interactive Mini Cards with backend-bound IDs
        cards = self.cmd._extract_cards(
            (DummyTC(),), [dummy_res], user_message="Tìm Hoàng Nam để kết bạn"
        )
        self.assertEqual(len(cards), 2)
        self.assertEqual(cards[0].payload.metadata["entityId"], "u-nam-1")
        self.assertEqual(cards[0].payload.metadata["interactionMode"], "inline_tier_a")
        self.assertEqual(cards[0].payload.metadata["inlineAction"], "send_friend_request")
        self.assertEqual(cards[1].payload.metadata["entityId"], "u-nam-2")

        # For Tier B destructive requests (e.g., "Chặn Hoàng Nam"), cards MUST downgrade to view_only
        tier_b_cards = self.cmd._extract_cards(
            (DummyTC(),), [dummy_res], user_message="Chặn Hoàng Nam giúp tôi"
        )
        self.assertEqual(len(tier_b_cards), 2)
        self.assertEqual(tier_b_cards[0].payload.metadata["interactionMode"], "view_only")
        self.assertIsNone(tier_b_cards[0].payload.metadata["inlineAction"])

    def test_respond_command_execute_intercepts_native_propose_account_action_meta_tool(
        self,
    ):
        import asyncio
        from unittest.mock import AsyncMock, MagicMock

        from app.modules.chatbot.navigation.resolver import NavDecision
        from app.modules.chatbot.tools.dispatcher import ToolDispatcher
        from app.providers.base import LlmGeneration, ToolCallInfo

        class NativeMetaToolProvider:
            def __init__(self):
                self.calls = 0

            async def generate(self, prompt, request, tools=None):
                self.calls += 1
                if self.calls == 1:
                    return LlmGeneration(
                        content="",
                        model="fake-groq",
                        provider="fake",
                        tool_calls=(
                            ToolCallInfo(
                                id="call_meta_1",
                                name="propose_account_action",
                                args={
                                    "action_name": "mark_all_notifications_read",
                                    "params": {},
                                    "reason": "Đánh dấu tất cả thông báo là đã đọc",
                                },
                            ),
                        ),
                    )
                return LlmGeneration(
                    content="Mình đã tạo thẻ xác nhận, bạn bấm nút bên dưới để hoàn tất nhé.",
                    model="fake-groq",
                    provider="fake",
                    tool_calls=(),
                )

        mock_dispatcher = MagicMock(spec=ToolDispatcher)
        mock_dispatcher.dispatch = AsyncMock()
        mock_nav = MagicMock()
        mock_nav.resolve.return_value = NavDecision(path="none")

        cmd = RespondCommand(
            provider=NativeMetaToolProvider(),
            tool_dispatcher_instance=mock_dispatcher,
            nav_resolver_instance=mock_nav,
        )
        req = AssistantRespondRequest(
            userId="u-meta-1",
            message="Đánh dấu tất cả thông báo đã đọc giúp mình",
            aiPolicy="FULL",
        )
        res = asyncio.run(cmd.execute(req))

        # Native meta-tool must NOT hit ToolDispatcher, and must emit a signed ProposeAction
        mock_dispatcher.dispatch.assert_not_awaited()
        self.assertEqual(len(res.proposals), 1)
        self.assertEqual(
            res.proposals[0].payload.actionName, "mark_all_notifications_read"
        )
        self.assertTrue(res.proposals[0].payload.proposalToken)

    def test_detect_action_proposals_rejects_negative_intent(self):
        req = AssistantRespondRequest(
            userId="u-1",
            aiPolicy="FULL",
            message="Đừng đánh dấu đã đọc thông báo nhé",
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 0)

    def test_native_meta_tool_propose_account_action_signs_global_and_rejects_entity_actions(self):
        from app.modules.chatbot.services.assistant_support.proposals import (
            build_proposal_from_meta_tool,
            verify_proposal_token,
        )

        proposal, feedback = build_proposal_from_meta_tool(
            {
                "action_name": "mark_all_notifications_read",
                "params": {},
                "reason": "Đánh dấu toàn bộ thông báo chưa đọc là đã đọc",
            },
            ai_policy="FULL",
            user_id="u-1",
            conversation_id="conv-1",
        )
        self.assertIsNotNone(proposal)
        assert proposal is not None
        self.assertEqual(proposal.payload.actionName, "mark_all_notifications_read")
        self.assertFalse(proposal.payload.isDestructive)
        self.assertIn("thẻ xác nhận", feedback)
        ok, err = verify_proposal_token(
            token=proposal.payload.proposalToken,
            user_id="u-1",
            conversation_id="conv-1",
            action_id=proposal.id,
            action_name=proposal.payload.actionName,
            params=proposal.payload.params,
            idempotency_key=proposal.payload.idempotencyKey,
        )
        self.assertTrue(ok)
        self.assertIsNone(err)

        # Rejected under RESTRICTED or any entity-targeted/excluded action
        restricted_prop, _ = build_proposal_from_meta_tool(
            {"action_name": "mark_all_notifications_read", "params": {}},
            ai_policy="RESTRICTED",
            user_id="u-1",
            conversation_id="conv-1",
        )
        self.assertIsNone(restricted_prop)
        for excluded in ("block_user", "send_friend_request", "join_group", "react_post"):
            excluded_prop, _ = build_proposal_from_meta_tool(
                {"action_name": excluded, "params": {"target_user_id": "u-1"}},
                ai_policy="FULL",
                user_id="u-1",
                conversation_id="conv-1",
            )
            self.assertIsNone(excluded_prop)

    def test_action_fence_stream_filter_suppresses_action_fences(self):
        from app.modules.chatbot.services.assistant import ActionFenceStreamFilter

        filter_stream = ActionFenceStreamFilter()
        chunks = [
            "Dưới đây là hành động: ",
            "```",
            "action\n",
            '{"actionName": "block_user"}\n',
            "```\n",
            "Bạn hãy xác nhận.",
        ]
        yielded = [filter_stream.process_chunk(c) for c in chunks]
        yielded.append(filter_stream.flush())
        filtered = "".join(yielded)
        self.assertEqual(filtered, "Dưới đây là hành động: Bạn hãy xác nhận.")
        self.assertNotIn("```action", filtered)
        self.assertNotIn("block_user", filtered)

    def test_action_fence_stream_filter_preserves_regular_code_blocks(self):
        from app.modules.chatbot.services.assistant import ActionFenceStreamFilter

        filter_stream = ActionFenceStreamFilter()
        chunks = [
            "Ví dụ code:\n",
            "```python\n",
            "print('hello world')\n",
            "```\n",
            "Hết code.",
        ]
        yielded = [filter_stream.process_chunk(c) for c in chunks]
        yielded.append(filter_stream.flush())
        filtered = "".join(yielded)
        self.assertEqual(
            filtered,
            "Ví dụ code:\n```python\nprint('hello world')\n```\nHết code.",
        )

    def test_proposal_token_signed_and_suppressed_when_restricted(self):
        from app.modules.chatbot.services.assistant_support.proposals import (
            verify_proposal_token,
        )

        req_full = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Đánh dấu tất cả thông báo đã đọc giúp mình",
        )
        proposals = self.cmd._detect_action_proposals(req_full, (), [])
        self.assertEqual(len(proposals), 1)
        payload = proposals[0].payload
        self.assertTrue(payload.proposalToken)
        ok, err = verify_proposal_token(
            token=payload.proposalToken,
            user_id="u-1",
            conversation_id="conv-1",
            action_id=proposals[0].id,
            action_name=payload.actionName,
            params=payload.params,
            idempotency_key=payload.idempotencyKey,
        )
        self.assertTrue(ok)
        self.assertIsNone(err)

        req_restricted = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="RESTRICTED",
            message="Đánh dấu tất cả thông báo đã đọc giúp mình",
        )
        self.assertEqual(self.cmd._detect_action_proposals(req_restricted, (), []), [])


if __name__ == "__main__":
    unittest.main()
