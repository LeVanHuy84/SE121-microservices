from __future__ import annotations

import os
import time
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
    get_redis_client,
    make_test_user_id,
    poll_until,
    run_prefix,
    seed_pg_user,
    start_isolated_gateway,
    stop_process,
)


class Slice1AGatewayPolicyMemoryTests(unittest.TestCase):
    run_id: str
    prefix: str

    @classmethod
    def setUpClass(cls) -> None:
        ensure_slice_ready("1A")
        cls.run_id = generate_run_id()
        cls.prefix = run_prefix(cls.run_id)

    @classmethod
    def tearDownClass(cls) -> None:
        cleanup_run_namespace(cls.prefix)
        redis_client = get_redis_client()
        try:
            leaked_keys = list(redis_client.scan_iter(match=f"*{cls.prefix}*", count=100))
            if leaked_keys:
                raise AssertionError(f"Leaked Redis keys after teardown: {leaked_keys}")
        finally:
            redis_client.close()

    def test_auth_forwarding_and_full_policy_cache(self) -> None:
        uid = make_test_user_id(self.run_id, "full")
        seed_pg_user(uid, ai_policy="FULL")
        clear_user_policy_cache(uid)

        resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers={"Authorization": f"Bearer {uid}"},
            json={
                "message": "Mở trang chủ giúp tôi [STUB:NAV_HOME]",
                "clientMessageId": str(uuid4()),
            },
            timeout=15.0,
        )
        self.assertIn(resp.status_code, (200, 201), resp.text)
        body = resp.json()
        self.assertTrue(body.get("success"))
        data = body.get("data", {})
        self.assertTrue(data.get("reply"))

        redis_client = get_redis_client()
        try:
            cached = redis_client.get(f"user:ai_policy:{uid}")
            self.assertEqual(cached, "FULL")
        finally:
            redis_client.close()

    def test_restricted_policy_enforced_and_cached(self) -> None:
        uid = make_test_user_id(self.run_id, "restricted")
        seed_pg_user(uid, ai_policy="RESTRICTED")
        clear_user_policy_cache(uid)

        resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers={"Authorization": f"Bearer {uid}"},
            json={
                "message": "Đánh dấu thông báo đã đọc [STUB:ACTION_POST]",
                "clientMessageId": str(uuid4()),
            },
            timeout=15.0,
        )
        self.assertIn(resp.status_code, (200, 201), resp.text)
        data = resp.json().get("data", {})
        self.assertEqual(data.get("proposals", []), [])

        redis_client = get_redis_client()
        try:
            cached = redis_client.get(f"user:ai_policy:{uid}")
            self.assertEqual(cached, "RESTRICTED")
        finally:
            redis_client.close()

    def test_negative_auth_rejects_when_load_test_mode_disabled(self) -> None:
        proc = None
        try:
            proc = start_isolated_gateway(
                port=4098,
                metrics_port=5098,
                extra_env={"ENABLE_LOAD_TEST_MODE": "false"},
            )
            missing_resp = httpx.post(
                "http://localhost:4098/api/v1/assistant/respond",
                json={"message": "Xin chào"},
                timeout=5.0,
            )
            self.assertIn(missing_resp.status_code, (401, 403))

            bad_resp = httpx.post(
                "http://localhost:4098/api/v1/assistant/respond",
                headers={"Authorization": "Bearer invalid.jwt.token"},
                json={"message": "Xin chào"},
                timeout=5.0,
            )
            self.assertIn(bad_resp.status_code, (401, 403))
        finally:
            stop_process(proc)

    def test_circuit_breaker_fails_closed_to_restricted(self) -> None:
        uid = make_test_user_id(self.run_id, "cb")
        clear_user_policy_cache(uid)
        proc = None
        try:
            proc = start_isolated_gateway(
                port=4099,
                metrics_port=5099,
                extra_env={
                    "ENABLE_LOAD_TEST_MODE": "true",
                    "USER_SOCIAL_SERVICE_PORT": "49999",
                },
            )
            for _ in range(3):
                r = httpx.post(
                    "http://localhost:4099/api/v1/assistant/respond",
                    headers={"Authorization": f"Bearer {uid}"},
                    json={
                        "message": "Đánh dấu thông báo đã đọc [STUB:ACTION_POST]",
                        "clientMessageId": str(uuid4()),
                    },
                    timeout=10.0,
                )
                self.assertIn(r.status_code, (200, 201), r.text)
                self.assertEqual(r.json().get("data", {}).get("proposals", []), [])

            started = time.perf_counter()
            fourth = httpx.post(
                "http://localhost:4099/api/v1/assistant/respond",
                headers={"Authorization": f"Bearer {uid}"},
                json={
                    "message": "Đánh dấu thông báo đã đọc [STUB:ACTION_POST]",
                    "clientMessageId": str(uuid4()),
                },
                timeout=5.0,
            )
            elapsed_ms = (time.perf_counter() - started) * 1000
            self.assertIn(fourth.status_code, (200, 201), fourth.text)
            self.assertEqual(fourth.json().get("data", {}).get("proposals", []), [])
            self.assertLess(
                elapsed_ms,
                900.0,
                f"Expected open circuit breaker to skip 1000ms RPC timeout, took {elapsed_ms:.1f}ms",
            )
        finally:
            stop_process(proc)

    def test_memory_v2_and_multi_session_history(self) -> None:
        uid = make_test_user_id(self.run_id, "mem")
        seed_pg_user(uid, ai_policy="FULL")
        clear_user_policy_cache(uid)
        headers = {"Authorization": f"Bearer {uid}"}

        c1_resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/conversations/me",
            headers=headers,
            json={"title": "Session 1"},
            timeout=10.0,
        )
        self.assertIn(c1_resp.status_code, (200, 201), c1_resp.text)
        c1_body = c1_resp.json()
        conv1_id = (c1_body.get("data") or c1_body)["id"]

        c2_resp = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/conversations/me",
            headers=headers,
            json={"title": "Session 2"},
            timeout=10.0,
        )
        self.assertIn(c2_resp.status_code, (200, 201), c2_resp.text)
        c2_body = c2_resp.json()
        conv2_id = (c2_body.get("data") or c2_body)["id"]

        list_resp = httpx.get(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/conversations/me",
            headers=headers,
            timeout=10.0,
        )
        self.assertEqual(list_resp.status_code, 200, list_resp.text)
        list_body = list_resp.json()
        list_payload = list_body.get("data") if "data" in list_body else list_body
        conv_ids = {c["id"] for c in list_payload.get("items", [])}
        self.assertIn(conv1_id, conv_ids)
        self.assertIn(conv2_id, conv_ids)

        r1 = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers=headers,
            json={
                "conversationId": conv1_id,
                "message": "Hướng dẫn mình cách tìm kiếm bạn bè trên Sentimeta nhé, mình là kỹ sư phần mềm và thích nghe nhạc [STUB:FACT_EXTRACT]",
                "clientMessageId": str(uuid4()),
            },
            timeout=15.0,
        )
        self.assertIn(r1.status_code, (200, 201), r1.text)
        self.assertEqual(r1.json().get("data", {}).get("type"), "answer", r1.text)

        mongo_db_name = os.getenv("MONGO_DB", "ai_chatbot_service")
        mongo_client = get_mongo_client()
        try:
            def _has_memory_facts():
                doc = mongo_client[mongo_db_name]["user_memory_profiles"].find_one(
                    {"_id": uid}
                )
                if doc and doc.get("facts"):
                    return doc
                return None

            profile_doc = poll_until(
                _has_memory_facts,
                timeout_seconds=10.0,
                description=f"Memory v2 profile for {uid}",
            )
            self.assertIn("occupation", profile_doc["facts"])
        finally:
            mongo_client.close()

        r2 = httpx.post(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/respond",
            headers=headers,
            json={
                "conversationId": conv2_id,
                "message": "Tin nhắn riêng trong phiên thứ hai [STUB:NAV_HOME]",
                "clientMessageId": str(uuid4()),
            },
            timeout=15.0,
        )
        self.assertIn(r2.status_code, (200, 201), r2.text)

        h1 = httpx.get(
            f"{DEFAULT_GATEWAY_URL}/api/v1/assistant/chat-history/me",
            headers=headers,
            params={"conversation_id": conv1_id},
            timeout=10.0,
        )
        self.assertEqual(h1.status_code, 200, h1.text)
        h1_body = h1.json()
        h1_payload = h1_body.get("data") if "data" in h1_body else h1_body
        h1_contents = " ".join(
            m.get("content", "") for m in h1_payload.get("items", [])
        )
        self.assertIn("kỹ sư phần mềm", h1_contents)
        self.assertNotIn("phiên thứ hai", h1_contents)


if __name__ == "__main__":
    unittest.main()
