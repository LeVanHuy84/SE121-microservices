from __future__ import annotations

import os
import unittest
from uuid import uuid4

import httpx

from tests.live.harness import (
    DEFAULT_GATEWAY_URL,
    cleanup_run_namespace,
    clear_user_policy_cache,
    ensure_slice_ready,
    generate_run_id,
    get_mongo_client,
    make_test_user_id,
    poll_until,
    run_prefix,
    seed_pg_user,
)


class Slice1BToolsAndActionsTests(unittest.TestCase):
    run_id: str
    prefix: str

    @classmethod
    def setUpClass(cls) -> None:
        ensure_slice_ready("1B")
        cls.run_id = generate_run_id()
        cls.prefix = run_prefix(cls.run_id)

    @classmethod
    def tearDownClass(cls) -> None:
        cleanup_run_namespace(cls.prefix)

    def test_surface_context_and_tool_routing(self) -> None:
        uid = make_test_user_id(self.run_id, "tools")
        seed_pg_user(uid, ai_policy="FULL")
        clear_user_policy_cache(uid)

        resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers={"Authorization": f"Bearer {uid}"},
            json={
                "message": "Xem danh sách bạn bè của tôi [STUB:TOOL_FRIENDS]",
                "clientMessageId": str(uuid4()),
                "surface": {"screen": "friends", "metadata": {}},
            },
            timeout=15.0,
        )
        self.assertIn(resp.status_code, (200, 201), resp.text)
        body = resp.json()
        self.assertTrue(body.get("success"))
        data = body.get("data", {})
        self.assertTrue(data.get("reply"))

    def test_action_proposal_execution_idempotency_and_audit(self) -> None:
        uid = make_test_user_id(self.run_id, "act")
        seed_pg_user(uid, ai_policy="FULL")
        clear_user_policy_cache(uid)
        headers = {"Authorization": f"Bearer {uid}"}

        resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers=headers,
            json={
                "message": "Hướng dẫn mình cách tương tác bài viết và đề xuất thao tác [STUB:ACTION_POST]",
                "clientMessageId": str(uuid4()),
            },
            timeout=15.0,
        )
        self.assertIn(resp.status_code, (200, 201), resp.text)
        data = resp.json().get("data", {})
        proposals = data.get("proposals", [])
        self.assertGreaterEqual(len(proposals), 1, f"Expected proposal in {data}")

        proposal = proposals[0]
        payload = proposal["payload"]
        exec_body = {
            "actionId": proposal["id"],
            "actionName": payload["actionName"],
            "params": payload.get("params", {}),
            "idempotencyKey": payload["idempotencyKey"],
            "proposalToken": payload["proposalToken"],
            "conversationId": data["conversationId"],
        }

        exec_resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/actions/execute",
            headers=headers,
            json=exec_body,
            timeout=15.0,
        )
        self.assertIn(exec_resp.status_code, (200, 201), exec_resp.text)
        self.assertTrue(exec_resp.json().get("success"))

        dup_resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/actions/execute",
            headers=headers,
            json=exec_body,
            timeout=15.0,
        )
        self.assertIn(dup_resp.status_code, (200, 201), dup_resp.text)
        self.assertTrue(dup_resp.json().get("success"))

        mongo_db_name = os.getenv("MONGO_DB", "ai_chatbot_service")
        mongo_client = get_mongo_client()
        try:

            def _find_audit():
                return mongo_client[mongo_db_name][
                    "chatbot_action_audit_logs"
                ].find_one(
                    {
                        "userId": uid,
                        "actionName": payload["actionName"],
                    }
                )

            audit_doc = poll_until(
                _find_audit,
                timeout_seconds=10.0,
                description=f"audit log for {uid}",
            )
            self.assertEqual(audit_doc["idempotencyKey"], payload["idempotencyKey"])
        finally:
            mongo_client.close()


if __name__ == "__main__":
    unittest.main()
