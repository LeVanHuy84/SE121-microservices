import asyncio
import os
import unittest
import httpx

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.dispatcher import ToolExecutionContext
from app.modules.chatbot.tools.handlers import MicroserviceToolHandlers
from app.modules.chatbot.tools.http_client import GatewayHttpClient


class ToolIntegrationTest(unittest.TestCase):
    def test_gateway_http_client_auth_forwarding(self):
        """Verifies that Authorization: Bearer <token> and x-internal-key are properly sent."""
        captured_requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={"success": True, "data": {"items": [1, 2, 3]}})

        transport = httpx.MockTransport(handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(base_url="http://mock-gateway:4000", client=mock_client)

        res = asyncio.run(client.get("/test/path", auth_token="my-jwt-token-xyz"))
        self.assertEqual(res, {"items": [1, 2, 3]})
        self.assertEqual(len(captured_requests), 1)
        req = captured_requests[0]
        self.assertEqual(req.headers["authorization"], "Bearer my-jwt-token-xyz")
        self.assertEqual(req.headers["x-internal-key"], "test-internal-key")

    def test_gateway_http_client_normalizes_prefixed_bearer(self):
        """Verifies that if token is passed with 'Bearer ' prefix, it does not double-prefix."""
        captured_requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={"data": {}})

        transport = httpx.MockTransport(handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(base_url="http://mock-gateway:4000", client=mock_client)

        asyncio.run(client.get("/test", auth_token="Bearer already-has-bearer"))
        self.assertEqual(captured_requests[0].headers["authorization"], "Bearer already-has-bearer")

    def test_gateway_http_client_timeout_degradation(self):
        """Verifies that timeouts are safely caught and return degraded error payload instead of raising."""
        def slow_handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("Timeout connecting to service", request=request)

        transport = httpx.MockTransport(slow_handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(base_url="http://mock-gateway:4000", client=mock_client)

        res = asyncio.run(client.get("/slow/path"))
        self.assertIsInstance(res, dict)
        self.assertEqual(res["_error"], "timeout")
        self.assertIn("quá thời gian", res["message"])

    def test_gateway_http_client_http_error_degradation(self):
        """Verifies that 500 or 503 HTTP errors are caught and degraded."""
        def error_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(503, text="Service Unavailable", request=request)

        transport = httpx.MockTransport(error_handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(base_url="http://mock-gateway:4000", client=mock_client)

        res = asyncio.run(client.get("/error/path"))
        self.assertIsInstance(res, dict)
        self.assertEqual(res["_error"], "http_503")
        self.assertEqual(res["status"], 503)

    def test_social_handlers_live_call(self):
        """Tests that social domain handler invokes the correct endpoint and handles data."""
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/social/requests":
                return httpx.Response(200, json={"success": True, "data": {"requests": [{"senderName": "Trần B"}]}})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(client=mock_client)
        handlers = MicroserviceToolHandlers(http_client=client)

        ctx = ToolExecutionContext(user_id="user-1", auth_token="token-abc")
        res = asyncio.run(handlers.get_my_friend_requests({}, ctx))
        self.assertEqual(res, {"requests": [{"senderName": "Trần B"}]})

    def test_groups_handlers_live_call(self):
        """Tests that groups domain handler queries /groups/my-groups correctly."""
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/groups/my-groups":
                return httpx.Response(200, json={"success": True, "data": [{"id": "grp-99", "name": "Nhóm thử nghiệm"}]})
            return httpx.Response(404)

        transport = httpx.MockTransport(handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(client=mock_client)
        handlers = MicroserviceToolHandlers(http_client=client)

        ctx = ToolExecutionContext(user_id="user-1", auth_token="token-abc")
        res = asyncio.run(handlers.get_my_groups({}, ctx))
        self.assertEqual(res, [{"id": "grp-99", "name": "Nhóm thử nghiệm"}])

    def test_handlers_fallback_when_downstream_fails(self):
        """When the gateway is down or returns error, handlers must return safe baseline fallback."""
        def failing_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="Internal Server Error", request=request)

        transport = httpx.MockTransport(failing_handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(client=mock_client)
        handlers = MicroserviceToolHandlers(http_client=client)

        ctx = ToolExecutionContext(user_id="user-1", auth_token="token-abc")
        res = asyncio.run(handlers.get_my_friend_requests({}, ctx))
        # Must return valid baseline data in mock mode, NOT crash
        self.assertIn("requests", res)
        self.assertGreater(len(res["requests"]), 0)

    def test_handlers_fallback_when_mock_disabled(self):
        """When mock fallbacks are disabled (e.g. in prod), personal data handlers return safe error without fake names."""
        from unittest.mock import patch
        def failing_handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="Internal Server Error", request=request)

        transport = httpx.MockTransport(failing_handler)
        mock_client = httpx.AsyncClient(transport=transport, base_url="http://mock-gateway:4000")
        client = GatewayHttpClient(client=mock_client)
        handlers = MicroserviceToolHandlers(http_client=client)

        ctx = ToolExecutionContext(user_id="user-1", auth_token="token-abc")
        with patch("app.core.settings.settings.TOOL_ENABLE_MOCK_FALLBACKS", False):
            res = asyncio.run(handlers.get_my_friend_requests({}, ctx))
            self.assertEqual(res["total"], 0)
            self.assertEqual(res["requests"], [])
            self.assertIn("error", res)


if __name__ == "__main__":
    unittest.main()
