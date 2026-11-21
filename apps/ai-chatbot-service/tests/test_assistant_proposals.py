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
            "Tôi có thể hỗ trợ bạn gửi lời mời kết bạn.\n"
            "```action\n"
            '{"actionName": "send_friend_request", "title": "Gửi kết bạn", "description": "Gửi lời mời cho Nam", "params": {"target_user_id": "u-999"}}\n'
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
        self.assertEqual(prop.payload.actionName, "send_friend_request")
        self.assertEqual(prop.payload.params, {"target_user_id": "u-999"})
        self.assertEqual(prop.payload.title, "Gửi kết bạn")
        # Idempotency key must be valid UUID
        self.assertTrue(UUID(prop.payload.idempotencyKey))
        # Raw block must be stripped from cleaned reply
        self.assertNotIn("```action", cleaned_reply)
        self.assertIn("Tôi có thể hỗ trợ bạn gửi lời mời kết bạn.", cleaned_reply)
        self.assertIn("Vui lòng nhấn nút xác nhận bên dưới nhé!", cleaned_reply)

    def test_extract_proposals_rejects_non_allowlisted_action(self):
        reply = (
            "```action\n" '{"actionName": "delete_database", "params": {}}\n' "```\n"
        )
        cleaned, proposals = self.cmd._extract_proposals_from_llm_reply(reply)
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

    def test_detect_action_proposals_send_friend_request_from_tool_results(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Gửi kết bạn cho Nam đi",
        )

        class DummyTC:
            name = "search_users"

        dummy_res = ToolExecutionResult(
            tool_name="search_users",
            success=True,
            data={
                "users": [{"id": "u-nam-123", "name": "Nam Nguyen", "username": "namn"}]
            },
        )
        proposals = self.cmd._detect_action_proposals(req, (DummyTC(),), [dummy_res])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "send_friend_request")
        self.assertEqual(proposals[0].payload.params, {"target_user_id": "u-nam-123"})
        self.assertIn("Nam Nguyen", proposals[0].payload.title)

    def test_detect_action_proposals_accept_friend_request_from_tool_results(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Đồng ý kết bạn với Nam",
        )

        class DummyTC:
            name = "get_my_friend_requests"

        dummy_res = ToolExecutionResult(
            tool_name="get_my_friend_requests",
            success=True,
            data={"requests": [{"requesterId": "u-req-456", "senderName": "Nam"}]},
        )
        proposals = self.cmd._detect_action_proposals(req, (DummyTC(),), [dummy_res])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "accept_friend_request")
        self.assertEqual(proposals[0].payload.params, {"requester_id": "u-req-456"})

    def test_detect_action_proposals_join_group_from_surface_context(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Cho mình tham gia nhóm với",
            surface=SurfaceContext(
                screen="groups.detail",
                entityId="grp-99",
                metadata={"groupName": "Sức Khỏe Tinh Thần"},
            ),
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "join_group")
        self.assertEqual(proposals[0].payload.params, {"group_id": "grp-99"})
        self.assertIn("Sức Khỏe Tinh Thần", proposals[0].payload.title)

    def test_detect_action_proposals_rejects_negative_intent(self):
        req = AssistantRespondRequest(
            userId="u-1",
            message="Tôi không muốn kết bạn với ai cả",
            surface=SurfaceContext(
                screen="social.profile",
                entityId="u-profile-99",
                metadata={"userName": "Minh"},
            ),
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 0)

    def test_detect_action_proposals_decline_friend_request(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Từ chối lời mời kết bạn của Nam",
        )

        class DummyTC:
            name = "get_my_friend_requests"

        dummy_res = ToolExecutionResult(
            tool_name="get_my_friend_requests",
            success=True,
            data={"requests": [{"requesterId": "u-nam-888", "senderName": "Nam"}]},
        )
        proposals = self.cmd._detect_action_proposals(req, (DummyTC(),), [dummy_res])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "decline_friend_request")
        self.assertEqual(proposals[0].payload.params, {"requester_id": "u-nam-888"})
        self.assertTrue(proposals[0].payload.isDestructive)
        self.assertEqual(proposals[0].payload.category, "social")

    def test_detect_action_proposals_unfriend_user(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Hủy kết bạn với người này",
            surface=SurfaceContext(
                screen="social.profile",
                entityId="u-bad-friend",
                metadata={"userName": "Huy"},
            ),
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "unfriend_user")
        self.assertEqual(
            proposals[0].payload.params, {"target_user_id": "u-bad-friend"}
        )
        self.assertTrue(proposals[0].payload.isDestructive)

    def test_detect_action_proposals_block_user(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Chặn người này giúp tôi",
            surface=SurfaceContext(
                screen="social.profile",
                entityId="u-spammer",
                metadata={"userName": "Spammer"},
            ),
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(len(proposals), 1)
        self.assertEqual(proposals[0].payload.actionName, "block_user")
        self.assertEqual(proposals[0].payload.params, {"target_user_id": "u-spammer"})
        self.assertTrue(proposals[0].payload.isDestructive)

    def test_detect_action_proposals_excludes_react_post(self):
        req = AssistantRespondRequest(
            userId="u-1",
            conversationId="conv-1",
            aiPolicy="FULL",
            message="Thả tim bài viết này giúp mình",
            surface=SurfaceContext(screen="feed.post", entityId="post-xyz"),
        )
        proposals = self.cmd._detect_action_proposals(req, (), [])
        self.assertEqual(proposals, [])

    def test_native_meta_tool_propose_account_action_signs_and_warns_tier_b(self):
        from app.modules.chatbot.services.assistant_support.proposals import (
            build_proposal_from_meta_tool,
            verify_proposal_token,
        )

        proposal, feedback = build_proposal_from_meta_tool(
            {
                "action_name": "block_user",
                "params": {"target_user_id": "u-spammer"},
                "reason": "Chặn tài khoản làm phiền",
            },
            ai_policy="FULL",
            user_id="u-1",
            conversation_id="conv-1",
        )
        self.assertIsNotNone(proposal)
        assert proposal is not None
        self.assertEqual(proposal.payload.actionName, "block_user")
        self.assertTrue(proposal.payload.isDestructive)
        self.assertIn("Lưu ý", proposal.payload.description)
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

        # Rejected under RESTRICTED or excluded action (react_post)
        restricted_prop, _ = build_proposal_from_meta_tool(
            {"action_name": "mark_all_notifications_read", "params": {}},
            ai_policy="RESTRICTED",
            user_id="u-1",
            conversation_id="conv-1",
        )
        self.assertIsNone(restricted_prop)
        excluded_prop, _ = build_proposal_from_meta_tool(
            {"action_name": "react_post", "params": {"post_id": "p-1"}},
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
