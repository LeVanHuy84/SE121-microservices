import unittest
from unittest.mock import AsyncMock
from uuid import uuid4

from app.modules.chatbot.actions.executor import ActionExecutorService
from app.modules.chatbot.actions.registry import ALLOWLISTED_ACTIONS, is_action_allowed
from app.modules.chatbot.schemas import ActionExecutionRequest


class ActionExecutionTest(unittest.IsolatedAsyncioTestCase):
    def test_action_registry_allowlist(self):
        self.assertTrue(is_action_allowed("send_friend_request"))
        self.assertTrue(is_action_allowed("accept_friend_request"))
        self.assertTrue(is_action_allowed("decline_friend_request"))
        self.assertTrue(is_action_allowed("cancel_friend_request"))
        self.assertTrue(is_action_allowed("unfriend_user"))
        self.assertTrue(is_action_allowed("block_user"))
        self.assertTrue(is_action_allowed("join_group"))
        self.assertTrue(is_action_allowed("leave_group"))
        self.assertTrue(is_action_allowed("react_post"))
        self.assertTrue(is_action_allowed("mark_all_notifications_read"))

        self.assertEqual(len(ALLOWLISTED_ACTIONS), 10)

        # Verify metadata
        self.assertTrue(ALLOWLISTED_ACTIONS["decline_friend_request"].is_destructive)
        self.assertTrue(ALLOWLISTED_ACTIONS["unfriend_user"].is_destructive)
        self.assertTrue(ALLOWLISTED_ACTIONS["block_user"].is_destructive)
        self.assertFalse(ALLOWLISTED_ACTIONS["react_post"].is_destructive)
        self.assertEqual(ALLOWLISTED_ACTIONS["react_post"].category, "content")

        self.assertFalse(is_action_allowed("delete_account"))
        self.assertFalse(is_action_allowed("transfer_funds"))
        self.assertFalse(is_action_allowed("unregistered_arbitrary_action"))

    async def test_reject_unallowlisted_action(self):
        executor = ActionExecutorService(AsyncMock(), redis_client=False)
        req = ActionExecutionRequest(
            actionId="act-1",
            actionName="delete_database",
            params={},
            idempotencyKey=f"idem-{uuid4()}",
        )
        res = await executor.execute(req)
        self.assertFalse(res.success)
        self.assertEqual(res.error, "ACTION_NOT_ALLOWLISTED")

    async def test_idempotent_replay_returns_cached(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)

        req = ActionExecutionRequest(
            actionId="act-2",
            actionName="send_friend_request",
            params={"target_user_id": "user-456"},
            idempotencyKey=f"idem-key-{uuid4()}",
        )

        # First call
        res1 = await executor.execute(req, auth_token="jwt-123")
        self.assertTrue(res1.success)

        # Second call with same idempotencyKey
        res2 = await executor.execute(req, auth_token="jwt-123")
        self.assertTrue(res2.success)
        self.assertEqual(res1.message, res2.message)

        # HTTP post should only be called once because of idempotency replay!
        self.assertEqual(mock_http.post.call_count, 1)

    async def test_missing_required_param_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)
        req = ActionExecutionRequest(
            actionId="act-3",
            actionName="join_group",
            params={},  # missing group_id
            idempotencyKey=f"idem-{uuid4()}",
        )
        res = await executor.execute(req, auth_token="jwt")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "MISSING_PARAM")
        mock_http.post.assert_not_called()

    async def test_rapid_concurrent_double_click_idempotency(self):
        mock_http = AsyncMock()
        mock_http.patch.return_value = {"id": "notif-read-ok"}
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)
        req = ActionExecutionRequest(
            actionId="act-4",
            actionName="mark_all_notifications_read",
            params={},
            idempotencyKey=f"idem-concurrent-{uuid4()}",
        )
        # Simulate rapid double click
        import asyncio
        results = await asyncio.gather(
            executor.execute(req, auth_token="jwt"),
            executor.execute(req, auth_token="jwt"),
        )
        self.assertEqual(len(results), 2)
        self.assertTrue(results[0].success)
        self.assertTrue(results[1].success)
        # Downstream patch must only be invoked once
        self.assertEqual(mock_http.patch.call_count, 1)

    async def test_failure_not_cached_allowing_retry(self):
        mock_http = AsyncMock()
        # First call fails with 500 error
        mock_http.post.side_effect = [
            {"_error": "internal_error", "message": "Downstream timed out"},
            {"status": "ok"},
        ]
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)
        idem_key = f"idem-retry-{uuid4()}"
        req = ActionExecutionRequest(
            actionId="act-5",
            actionName="send_friend_request",
            params={"target_user_id": "user-789"},
            idempotencyKey=idem_key,
        )

        # Attempt 1: fails
        res1 = await executor.execute(req, auth_token="jwt-1")
        self.assertFalse(res1.success)

        # Attempt 2: retry with same idempotencyKey should be allowed and succeed
        res2 = await executor.execute(req, auth_token="jwt-1")
        self.assertTrue(res2.success)
        self.assertEqual(mock_http.post.call_count, 2)

    async def test_header_precedence_over_body(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)
        req = ActionExecutionRequest(
            actionId="act-6",
            actionName="send_friend_request",
            params={"target_user_id": "user-target"},
            idempotencyKey=f"idem-sec-{uuid4()}",
            authToken="untrusted-body-token",
            userId="untrusted-body-user",
        )
        res = await executor.execute(req, auth_token="trusted-header-token", user_id="trusted-header-user")
        self.assertTrue(res.success)
        # Verify the trusted header token was forwarded, not the body token
        mock_http.post.assert_called_once_with(
            "/social/request/user-target",
            json_body={},
            auth_token="trusted-header-token",
        )

    async def test_execute_new_expanded_actions(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        executor = ActionExecutorService(mock_http, redis_client=False, enable_mock=False)

        # 1. decline_friend_request
        req_decline = ActionExecutionRequest(
            actionId="act-dec",
            actionName="decline_friend_request",
            params={"requester_id": "u-req-1"},
            idempotencyKey=f"idem-dec-{uuid4()}",
        )
        res = await executor.execute(req_decline, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/decline/u-req-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 2. unfriend_user
        req_unfriend = ActionExecutionRequest(
            actionId="act-unf",
            actionName="unfriend_user",
            params={"target_user_id": "u-friend-1"},
            idempotencyKey=f"idem-unf-{uuid4()}",
        )
        res = await executor.execute(req_unfriend, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/remove/u-friend-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 3. block_user
        req_block = ActionExecutionRequest(
            actionId="act-blk",
            actionName="block_user",
            params={"target_user_id": "u-bad-1"},
            idempotencyKey=f"idem-blk-{uuid4()}",
        )
        res = await executor.execute(req_block, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/block/u-bad-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 4. react_post
        req_react = ActionExecutionRequest(
            actionId="act-rxn",
            actionName="react_post",
            params={"post_id": "p-100", "reaction_type": "love"},
            idempotencyKey=f"idem-rxn-{uuid4()}",
        )
        res = await executor.execute(req_react, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/reactions",
            json_body={
                "targetId": "p-100",
                "targetType": "POST",
                "reactionType": "LOVE",
            },
            auth_token="jwt-tok",
        )

        # 5. join_group
        req_join = ActionExecutionRequest(
            actionId="act-join",
            actionName="join_group",
            params={"group_id": "g-123"},
            idempotencyKey=f"idem-join-{uuid4()}",
        )
        res = await executor.execute(req_join, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/groups/g-123/join-requests",
            json_body={},
            auth_token="jwt-tok",
        )

        # 6. leave_group
        req_leave = ActionExecutionRequest(
            actionId="act-leave",
            actionName="leave_group",
            params={"group_id": "g-123"},
            idempotencyKey=f"idem-leave-{uuid4()}",
        )
        res = await executor.execute(req_leave, auth_token="jwt-tok")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/groups/g-123/members/leave",
            json_body={},
            auth_token="jwt-tok",
        )
