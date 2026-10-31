import os
import unittest
from unittest.mock import AsyncMock, patch

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.settings import settings as core_settings
from app.modules.chatbot import public_router as pr
from app.modules.chatbot.router import assistant_router
from app.modules.chatbot.services.rag_indexer import rag_indexer_service

KEY = core_settings.INTERNAL_SERVICE_KEY
INTERNAL = {"X-Internal-Key": KEY}
PUBLIC = {"X-Internal-Key": KEY, "X-User-Id": "user-1"}
CLICK_BODY = {"actionId": "act-1", "destinationId": "settings.privacy"}
TELEMETRY_CLICK = "app.modules.chatbot.navigation.telemetry.intent_telemetry.record_action_click"


def _client() -> TestClient:
    app = FastAPI()
    pr.register_public_error_handlers(app)
    app.include_router(pr.public_router)
    app.include_router(assistant_router)
    return TestClient(app, raise_server_exceptions=False)


class InternalActionClickTest(unittest.TestCase):
    def setUp(self):
        self.client = _client()

    def test_requires_internal_key(self):
        res = self.client.post(
            "/assistant/actions/click",
            json={"userId": "u", **CLICK_BODY},
            headers={"X-Internal-Key": "wrong"},
        )
        self.assertIn(res.status_code, (401, 403))

    def test_records_click(self):
        with patch(TELEMETRY_CLICK, new=AsyncMock(return_value=True)) as mocked:
            res = self.client.post(
                "/assistant/actions/click", json={"userId": "u1", **CLICK_BODY}, headers=INTERNAL
            )

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"success": True, "recorded": True})
        mocked.assert_awaited_once_with(user_id="u1", action_id="act-1", destination_id="settings.privacy")

    def test_rejects_oversized_ids(self):
        body = {"userId": "u1", "actionId": "x" * 129, "destinationId": "settings.privacy"}
        res = self.client.post("/assistant/actions/click", json=body, headers=INTERNAL)
        self.assertEqual(res.status_code, 422)


class PublicActionClickTest(unittest.TestCase):
    def setUp(self):
        self.client = _client()

    def test_requires_gateway_auth(self):
        res = self.client.post("/v1/assistant/actions/click", json=CLICK_BODY)
        self.assertEqual(res.status_code, 403)

    def test_requires_user_id(self):
        res = self.client.post("/v1/assistant/actions/click", json=CLICK_BODY, headers=INTERNAL)
        self.assertEqual(res.status_code, 401)

    def test_records_click_for_gateway_user(self):
        with patch(TELEMETRY_CLICK, new=AsyncMock(return_value=True)) as mocked:
            res = self.client.post("/v1/assistant/actions/click", json=CLICK_BODY, headers=PUBLIC)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"success": True, "data": {"recorded": True}})
        mocked.assert_awaited_once_with(user_id="user-1", action_id="act-1", destination_id="settings.privacy")


class RagReindexEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = _client()

    def test_requires_internal_key(self):
        res = self.client.post("/assistant/admin/rag/reindex", headers={"X-Internal-Key": "wrong"})
        self.assertIn(res.status_code, (401, 403))

    def test_accepts_and_runs_reindex_in_background(self):
        with patch.object(rag_indexer_service, "trigger_reindex", new=AsyncMock()) as mocked:
            res = self.client.post("/assistant/admin/rag/reindex?force=true", headers=INTERNAL)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["status"], "accepted")
        mocked.assert_awaited_once_with(force=True)

    def test_reports_in_progress_without_scheduling(self):
        with patch.object(
            type(rag_indexer_service), "is_indexing", new=property(lambda self: True)
        ), patch.object(rag_indexer_service, "trigger_reindex", new=AsyncMock()) as mocked:
            res = self.client.post("/assistant/admin/rag/reindex", headers=INTERNAL)

        self.assertEqual(res.json()["status"], "in_progress")
        mocked.assert_not_awaited()


class TelemetryStatsEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = _client()

    def test_requires_internal_key(self):
        res = self.client.get("/assistant/admin/telemetry/stats", headers={"X-Internal-Key": "wrong"})
        self.assertIn(res.status_code, (401, 403))

    def test_returns_stats_payload(self):
        sample_stats = {"total_offers": 10, "total_clicks": 3, "ctr_percentage": 30.0}
        with patch("app.modules.chatbot.navigation.telemetry.intent_telemetry.get_stats", new=AsyncMock(return_value=sample_stats)):
            res = self.client.get("/assistant/admin/telemetry/stats", headers=INTERNAL)

        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"success": True, "data": sample_stats})


class ReadinessProbeTest(unittest.TestCase):
    def test_ready_reports_navigator_catalog(self):
        from app.main import app as main_app
        client = TestClient(main_app)
        res = client.get("/ready")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "ready")
        self.assertIn("navigator", body)
        self.assertEqual(body["navigator"]["status"], "ready")
        self.assertGreaterEqual(body["navigator"]["destinations_count"], 18)


if __name__ == "__main__":
    unittest.main()
