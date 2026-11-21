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
        # Only zero-ambiguity global/account actions are allowlisted
        self.assertTrue(is_action_allowed("mark_all_notifications_read"))
        self.assertEqual(len(ALLOWLISTED_ACTIONS), 1)
        self.assertFalse(
            ALLOWLISTED_ACTIONS["mark_all_notifications_read"].is_destructive
        )

        # All entity-targeted social/group actions and destructive actions are excluded
        for excluded in (
            "send_friend_request",
            "accept_friend_request",
            "decline_friend_request",
            "cancel_friend_request",
            "unfriend_user",
            "block_user",
            "join_group",
            "leave_group",
            "react_post",
            "delete_account",
            "transfer_funds",
            "unregistered_arbitrary_action",
        ):
            with self.subTest(action=excluded):
                self.assertFalse(is_action_allowed(excluded))

    async def test_reject_unallowlisted_action(self):
        executor = ActionExecutorService(
            AsyncMock(), redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        for excluded in (
            "delete_database",
            "send_friend_request",
            "accept_friend_request",
            "decline_friend_request",
            "cancel_friend_request",
            "unfriend_user",
            "block_user",
            "join_group",
            "leave_group",
            "react_post",
        ):
            with self.subTest(action=excluded):
                req = _make_signed_request(
                    action_id=f"act-{excluded}",
                    action_name=excluded,
                    params={},
                )
                res = await executor.execute(req, user_id="u-1")
                self.assertFalse(res.success)
                self.assertEqual(res.error, "ACTION_NOT_ALLOWLISTED")

    async def test_idempotent_replay_returns_cached(self):
        mock_http = AsyncMock()
        mock_http.patch.return_value = {"status": "ok"}
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )

        req = _make_signed_request(
            action_id="act-2",
            action_name="mark_all_notifications_read",
            params={},
        )

        res1 = await executor.execute(req, auth_token="jwt-123", user_id="u-1")
        self.assertTrue(res1.success)

        res2 = await executor.execute(req, auth_token="jwt-123", user_id="u-1")
        self.assertTrue(res2.success)
        self.assertEqual(res1.message, res2.message)
        self.assertEqual(mock_http.patch.call_count, 1)

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
        self.assertEqual(mock_http.patch.call_count, 1)

    async def test_failure_not_cached_allowing_retry(self):
        mock_http = AsyncMock()
        mock_http.patch.side_effect = [
            {"_error": "internal_error", "message": "Downstream timed out"},
            {"status": "ok"},
        ]
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-5",
            action_name="mark_all_notifications_read",
            params={},
        )

        res1 = await executor.execute(req, auth_token="jwt-1", user_id="u-1")
        self.assertFalse(res1.success)

        res2 = await executor.execute(req, auth_token="jwt-1", user_id="u-1")
        self.assertTrue(res2.success)
        self.assertEqual(mock_http.patch.call_count, 2)

    async def test_header_precedence_over_body(self):
        mock_http = AsyncMock()
        mock_http.patch.return_value = {"status": "ok"}
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        idem = f"idem-sec-{uuid4()}"
        token, _ = sign_proposal_token(
            user_id="trusted-header-user",
            conversation_id="conv-1",
            action_id="act-6",
            action_name="mark_all_notifications_read",
            params={},
            idempotency_key=idem,
        )
        req = ActionExecutionRequest(
            actionId="act-6",
            actionName="mark_all_notifications_read",
            params={},
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
        mock_http.patch.assert_called_once_with(
            "/notifications/read-all",
            json_body={},
            auth_token="trusted-header-token",
        )

    async def test_tampered_proposal_token_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-tamp",
            action_name="mark_all_notifications_read",
            params={},
        )
        req.params = {"injected": True}
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_INVALID")
        mock_http.patch.assert_not_called()

    async def test_expired_proposal_token_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-exp",
            action_name="mark_all_notifications_read",
            params={},
            expires_at=int(time.time()) - 10,
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_EXPIRED")
        mock_http.patch.assert_not_called()

    async def test_restricted_ai_policy_rejected(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-pol",
            action_name="mark_all_notifications_read",
            params={},
            ai_policy="RESTRICTED",
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "AI_POLICY_RESTRICTED")
        mock_http.patch.assert_not_called()

    async def test_redis_unavailable_fails_closed(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(fail=True), enable_mock=False
        )
        req = _make_signed_request(
            action_id="act-redis-down",
            action_name="mark_all_notifications_read",
            params={},
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "ACTION_IDEMPOTENCY_UNAVAILABLE")
        mock_http.patch.assert_not_called()

    async def test_production_mock_guard_blocks_execution(self):
        mock_http = AsyncMock()
        executor = ActionExecutorService(
            mock_http, redis_client=_FakeAsyncRedis(), enable_mock=True
        )
        req = _make_signed_request(
            action_id="act-prod-mock",
            action_name="mark_all_notifications_read",
            params={},
        )
        with patch("app.modules.chatbot.actions.executor.settings") as mock_settings:
            mock_settings.APP_ENV = "production"
            res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertFalse(res.success)
        self.assertEqual(res.error, "MOCK_FALLBACK_FORBIDDEN_IN_PROD")

    async def test_audit_log_emitted_on_execute(self):
        mock_http = AsyncMock()
        mock_http.patch.return_value = {"status": "ok"}
        mock_audit = AsyncMock(spec=ActionAuditLogger)
        executor = ActionExecutorService(
            mock_http,
            redis_client=_FakeAsyncRedis(),
            enable_mock=False,
            audit_logger=mock_audit,
        )
        req = _make_signed_request(
            action_id="act-audit",
            action_name="mark_all_notifications_read",
            params={},
        )
        res = await executor.execute(req, auth_token="jwt-tok", user_id="u-1")
        self.assertTrue(res.success)
        mock_audit.record.assert_awaited_once()
        call_kwargs = mock_audit.record.call_args.kwargs
        self.assertEqual(call_kwargs["user_id"], "u-1")
        self.assertEqual(call_kwargs["action_name"], "mark_all_notifications_read")
        self.assertEqual(call_kwargs["status"], "succeeded")


if __name__ == "__main__":
    unittest.main()
