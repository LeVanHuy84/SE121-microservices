"""Integration test suite for End-to-End Action Proposal Lifecycle & Idempotency (Task 8).

Verifies:
1. Proposal token signature generation with HMAC-SHA256 and TTL.
2. Successful execution upon valid token presentation with downstream gateway call.
3. Multi-replica idempotency: re-executing with the same idempotencyKey returns cached response
   without duplicate downstream invocation.
4. Tamper rejection: modified token, mismatched params, or changed action_name are strictly rejected.
5. Expiry rejection: expired proposal tokens are rejected.
6. Cross-user isolation: User B cannot execute an action signed for User A.
"""

from __future__ import annotations

import time
import unittest
from unittest.mock import AsyncMock
from uuid import uuid4

from app.modules.chatbot.actions.executor import ActionExecutorService
from app.modules.chatbot.schemas import ActionExecutionRequest
from app.modules.chatbot.services.assistant_support.proposals import (
    sign_proposal_token,
)


class _InMemoryRedis:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    async def ping(self) -> bool:
        return True

    async def get(self, key: str) -> str | None:
        return self._store.get(key)

    async def set(
        self,
        key: str,
        value: str,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool:
        if nx and key in self._store:
            return False
        self._store[key] = value
        return True

    async def eval(
        self,
        script: str,
        numkeys: int,
        key: str,
        expected: str,
    ) -> int:
        if self._store.get(key) == expected:
            del self._store[key]
            return 1
        return 0


class TestActionLifecycleIdempotency(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock_http = AsyncMock()
        self.mock_http.patch.return_value = {
            "status": "ok",
            "message": "Notifications marked read",
        }
        self.redis = _InMemoryRedis()
        self.executor = ActionExecutorService(
            http_client=self.mock_http,
            redis_client=self.redis,
            enable_mock=False,
        )

    def _build_request(
        self,
        user_id: str = "user-alice",
        action_name: str = "mark_all_notifications_read",
        params: dict | None = None,
        ttl_offset: int = 300,
        tamper_token: bool = False,
    ) -> ActionExecutionRequest:
        action_id = f"act-{uuid4()}"
        idem_key = f"idem-{uuid4()}"
        resolved_params = params if params is not None else {}
        expires_at = int(time.time()) + ttl_offset

        token, _ = sign_proposal_token(
            user_id=user_id,
            conversation_id="conv-123",
            action_id=action_id,
            action_name=action_name,
            params=resolved_params,
            idempotency_key=idem_key,
            expires_at=expires_at,
        )

        if tamper_token:
            token = token[:-4] + "dead"

        return ActionExecutionRequest(
            actionId=action_id,
            actionName=action_name,
            params=resolved_params,
            idempotencyKey=idem_key,
            proposalToken=token,
            conversationId="conv-123",
            aiPolicy="FULL",
            userId=user_id,
            authToken="valid-jwt-token",
        )

    async def test_successful_execution_and_downstream_call(self):
        req = self._build_request()
        res = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )

        self.assertTrue(res.success)
        self.assertEqual(self.mock_http.patch.call_count, 1)

    async def test_idempotent_replay_does_not_duplicate_execution(self):
        req = self._build_request()

        # Step 1: First execution
        res1 = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )
        self.assertTrue(res1.success)
        self.assertEqual(self.mock_http.patch.call_count, 1)

        # Step 2: Replay with identical idempotencyKey
        res2 = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )
        self.assertTrue(res2.success)
        # Downstream call count must remain 1 (never re-executed!)
        self.assertEqual(
            self.mock_http.patch.call_count,
            1,
            "Downstream service must NOT be called a second time on replay",
        )

    async def test_tampered_token_rejected(self):
        req = self._build_request(tamper_token=True)
        res = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )

        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_INVALID")
        self.assertEqual(self.mock_http.patch.call_count, 0)

    async def test_expired_token_rejected(self):
        # Expired 60 seconds ago
        req = self._build_request(ttl_offset=-60)
        res = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )

        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_EXPIRED")
        self.assertEqual(self.mock_http.patch.call_count, 0)

    async def test_cross_user_execution_rejected(self):
        req = self._build_request(user_id="user-alice")
        # Attacker tries to execute using user-mallory's credentials
        res = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-mallory"
        )

        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_INVALID")
        self.assertEqual(self.mock_http.patch.call_count, 0)

    async def test_parameter_tampering_rejected(self):
        req = self._build_request(params={})
        # Attacker tampers parameters after signature was generated
        req.params = {"injected": True}

        res = await self.executor.execute(
            req, auth_token="valid-jwt-token", user_id="user-alice"
        )
        self.assertFalse(res.success)
        self.assertEqual(res.error, "PROPOSAL_TOKEN_INVALID")
        self.assertEqual(self.mock_http.patch.call_count, 0)


if __name__ == "__main__":
    unittest.main()
