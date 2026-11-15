import asyncio
import time
import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.modules.chatbot.actions.audit import ActionAuditLogger
from app.modules.chatbot.actions.executor import ActionExecutorService
from app.modules.chatbot.actions.registry import ALLOWLISTED_ACTIONS, is_action_allowed
from app.modules.chatbot.schemas import ActionExecutionRequest
from app.modules.chatbot.services.assistant_support.proposals import (
    sign_proposal_token,
)


class _FakeAsyncRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.store: dict[str, str] = {}
        self.fail = fail

    async def ping(self) -> bool:
        if self.fail:
            raise ConnectionError("redis down")
        return True

    async def get(self, key: str) -> str | None:
        if self.fail:
            raise ConnectionError("redis down")
        return self.store.get(key)

    async def set(
        self,
        key: str,
        value: str,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool:
        if self.fail:
            raise ConnectionError("redis down")
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    async def eval(
        self,
        script: str,
        numkeys: int,
        key: str,
        expected: str,
    ) -> int:
        if self.fail:
            raise ConnectionError("redis down")
        if self.store.get(key) == expected:
            del self.store[key]
            return 1
        return 0


def _make_signed_request(
    *,
    action_id: str,
    action_name: str,
    params: dict | None = None,
    idempotency_key: str | None = None,
    user_id: str = "u-1",
    conversation_id: str = "conv-1",
    ai_policy: str = "FULL",
    auth_token: str | None = None,
    expires_at: int | None = None,
) -> ActionExecutionRequest:
    idem = idempotency_key or f"idem-{uuid4()}"
    token, _ = sign_proposal_token(
        user_id=user_id,
        conversation_id=conversation_id,
        action_id=action_id,
        action_name=action_name,
        params=params,
        idempotency_key=idem,
        expires_at=expires_at,
    )
    return ActionExecutionRequest(
        actionId=action_id,
        actionName=action_name,
        params=params or {},
        idempotencyKey=idem,
        proposalToken=token,
        conversationId=conversation_id,
        aiPolicy=ai_policy,
        userId=user_id,
        authToken=auth_token,
    )


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
        executor = ActionExecutorService(
            AsyncMock(), redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-1",
            action_name="delete_database",
            params={},
        )
        res = await executor.execute(req, user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "ACTION_NOT_ALLOWLISTED")

    async def test_idempotent_replay_returns_cached(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )

        req = _make_signed_request(
            action_id="act-2",
            action_name="send_friend_request",
            params={"target_user_id": "user-456"},
        )

        # First call
        res1 = await executor.execute(req, auth_token="jwt-123", user_id="u-1")
        self.assertTrue(res1.success)

        # Second call with same idempotencyKey
        res2 = await executor.execute(req, auth_token="jwt-123", user_id="u-1")
        self.assertTrue(res2.success)
        self.assertEqual(res1.message, res2.message)

        # HTTP post should only be called once because of idempotency replay!
        self.assertEqual(mock_http.post.call_count, 1)

    async def test_missing_required_param_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-3",
            action_name="join_group",
            params={},  # missing group_id
        )
        res = await executor.execute(req, auth_token="jwt", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "MISSING_PARAM")
        mock_http.post.assert_not_called()

    async def test_rapid_concurrent_double_click_idempotency(self):
        mock_http = AsyncMock()

        async def _slow_patch(*args, **kwargs):
            await asyncio.sleep(0.05)
            return {"id": "notif-read-ok"}

        mock_http.patch.side_effect = _slow_patch
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-4",
            action_name="mark_all_notifications_read",
            params={},
        )

        results = await asyncio.gather(
            executor.execute(req, auth_token="jwt", user_id="u-1"),
            executor.execute(req, auth_token="jwt", user_id="u-1"),
        )
        self.assertEqual(len(results), 2)
        successes = [r for r in results if r.success]
        in_progress = [r for r in results if r.error == "ACTION_IN_PROGRESS"]
        self.assertEqual(len(successes), 1)
        self.assertEqual(len(in_progress), 1)
        # Downstream patch must only be invoked once
        self.assertEqual(mock_http.patch.call_count, 1)

    async def test_failure_not_cached_allowing_retry(self):
        mock_http = AsyncMock()
        mock_http.post.side_effect = [
            {"_error": "internal_error", "message": "Downstream timed out"},
            {"status": "ok"},
        ]
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-5",
            action_name="send_friend_request",
            params={"target_user_id": "user-789"},
        )

        # Attempt 1: fails and releases in-flight lease
        res1 = await executor.execute(req, auth_token="jwt-1", user_id="u-1")
        self.assertFalse(res1.success)

        # Attempt 2: retry with same idempotencyKey should be allowed and succeed
        res2 = await executor.execute(req, auth_token="jwt-1", user_id="u-1")
        self.assertTrue(res2.success)
        self.assertEqual(mock_http.post.call_count, 2)

    async def test_header_precedence_over_body(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        idem = f"idem-sec-{uuid4()}"
        # Sign token for trusted header userId
        token, _ = sign_proposal_token(
            user_id="trusted-header-user",
            conversation_id="conv-1",
            action_id="act-6",
            action_name="send_friend_request",
            params={"target_user_id": "user-target"},
            idempotency_key=idem,
        )
        req = ActionExecutionRequest(
            actionId="act-6",
            actionName="send_friend_request",
            params={"target_user_id": "user-target"},
            idempotencyKey=idem,
            proposalToken=token,
            conversationId="conv-1",
            aiPolicy="FULL",
            authToken="untrusted-body-token",
            userId="untrusted-body-user",
        )
        res = await executor.execute(
            req, auth_token="trusted-header-token", user_id="trusted-header-user"
        )
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
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )

        # 1. decline_friend_request
        req_decline = _make_signed_request(
            action_id="act-dec",
            action_name="decline_friend_request",
            params={"requester_id": "u-req-1"},
        )
        res = await executor.execute(req_decline, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/decline/u-req-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 2. unfriend_user
        req_unfriend = _make_signed_request(
            action_id="act-unf",
            action_name="unfriend_user",
            params={"target_user_id": "u-friend-1"},
        )
        res = await executor.execute(req_unfriend, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/remove/u-friend-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 3. block_user
        req_block = _make_signed_request(
            action_id="act-blk",
            action_name="block_user",
            params={"target_user_id": "u-bad-1"},
        )
        res = await executor.execute(req_block, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/social/block/u-bad-1",
            json_body={},
            auth_token="jwt-tok",
        )

        # 4. react_post
        req_react = _make_signed_request(
            action_id="act-rxn",
            action_name="react_post",
            params={"post_id": "p-100", "reaction_type": "love"},
        )
        res = await executor.execute(req_react, auth_token="jwt-tok", user_id="u-1")
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
        req_join = _make_signed_request(
            action_id="act-join",
            action_name="join_group",
            params={"group_id": "g-123"},
        )
        res = await executor.execute(req_join, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/groups/g-123/join-requests",
            json_body={},
            auth_token="jwt-tok",
        )

        # 6. leave_group
        req_leave = _make_signed_request(
            action_id="act-leave",
            action_name="leave_group",
            params={"group_id": "g-123"},
        )
        res = await executor.execute(req_leave, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_http.post.assert_called_with(
            "/groups/g-123/members/leave",
            json_body={},
            auth_token="jwt-tok",
        )

    async def test_tampered_proposal_token_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-tamp",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
        )
        # Tamper with params after signing
        req.params = {"target_user_id": "u-attacker"}
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_INVALID")
        mock_http.post.assert_not_called()

    async def test_expired_proposal_token_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-exp",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
            expires_at=int(time.time()) - 10,
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_EXPIRED")
        mock_http.post.assert_not_called()

    async def test_restricted_ai_policy_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-pol",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
            ai_policy="RESTRICTED",
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "AI_POLICY_RESTRICTED")
        mock_http.post.assert_not_called()

    async def test_redis_unavailable_fails_closed(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(fail=True), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-redis-down",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "ACTION_IDEMPOTENCY_UNAVAILABLE")
        mock_http.post.assert_not_called()

    async def test_production_mock_guard_blocks_execution(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=True
        )
        req = _make_signed_request(
            action_id="act-prod-mock",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
        )
        with patch(
            "app.modules.chatbot.actions.executor.settings"
        ) as mock_settings:
            mock_settings.APP_ENV = "production"
            res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "MOCK_FALLBACK_FORBIDDEN_IN_PROD")

    async def test_audit_log_emitted_on_execute(self):
        mock_http = AsyncMock()
        mock_http.post.return_value = {"status": "ok"}
        mock_audit = AsyncMock(spec=ActionAuditLogger)
        executor = ActionExecutorService(
            mock_http,
            redis_client=_FakeAsyncRedis(),
            enable_mock=False,
            audit_logger=mock_audit,
        )
        req = _make_signed_request(
            action_id="act-audit",
            action_name="send_friend_request",
            params={"target_user_id": "u-target"},
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_audit.record.assert_awaited_once()
        call_kwargs = mock_audit.record.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], "u-1")
        self.assertEqual(call_kwargs["action_name"], "send_friend_request")
        self.assertEqual(call_kwargs["status"], "succeeded")
