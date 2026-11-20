from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.core.settings import Settings
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.providers.stub_provider import StubLlmProvider


class StubProviderTests(unittest.IsolatedAsyncioTestCase):
    def test_settings_reject_stub_mode_in_production(self) -> None:
        with patch.dict(
            os.environ,
            {
                "APP_ENV": "production",
                "CHATBOT_LLM_STUB_MODE": "true",
                "INTERNAL_SERVICE_KEY": "k",
                "PROPOSAL_HMAC_KEY": "h",
            },
            clear=False,
        ):
            with self.assertRaises(RuntimeError):
                Settings()

    async def test_stub_provider_deterministic_markers(self) -> None:
        provider = StubLlmProvider()
        req = AssistantRespondRequest(userId="u1", message="test [STUB:NAV_HOME]")
        nav_gen = await provider.generate("test [STUB:NAV_HOME]", req)
        self.assertEqual(nav_gen.provider, "stub")
        self.assertIn("home", nav_gen.content)

        tool_req = AssistantRespondRequest(
            userId="u1", message="friends [STUB:TOOL_FRIENDS]"
        )
        tool_gen = await provider.generate(
            [{"role": "user", "content": "friends [STUB:TOOL_FRIENDS]"}],
            tool_req,
            tools=[{"type": "function", "function": {"name": "get_my_friends"}}],
        )
        self.assertEqual(len(tool_gen.tool_calls), 1)
        self.assertEqual(tool_gen.tool_calls[0].name, "get_my_friends")

        synth_gen = await provider.generate(
            [
                {"role": "user", "content": "friends [STUB:TOOL_FRIENDS]"},
                {"role": "tool", "content": '{"friends": []}'},
            ],
            tool_req,
            tools=[{"type": "function", "function": {"name": "get_my_friends"}}],
        )
        self.assertEqual(synth_gen.tool_calls, ())
        self.assertTrue(synth_gen.content)

        act_req = AssistantRespondRequest(
            userId="u1", message="action [STUB:ACTION_POST]"
        )
        act_gen = await provider.generate("action [STUB:ACTION_POST]", act_req)
        self.assertIn("```action", act_gen.content)
        self.assertIn("mark_all_notifications_read", act_gen.content)

        fact_req = AssistantRespondRequest(
            userId="u1", message="fact", intent="fact_extraction"
        )
        fact_gen = await provider.generate(
            "Long-term Fact Extractor [STUB:FACT_EXTRACT]", fact_req, json_mode=True
        )
        self.assertIn('"occupation"', fact_gen.content)

    def test_ready_endpoint_allows_stub_mode_without_groq_key(self) -> None:
        from app.main import app, settings as main_settings

        with (
            patch.object(main_settings, "CHATBOT_LLM_STUB_MODE", True),
            patch.object(main_settings, "GROQ_API_KEY", ""),
        ):
            client = TestClient(app)
            resp = client.get("/ready")
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            self.assertEqual(body["status"], "ready")
            self.assertEqual(body["provider"], "stub")


if __name__ == "__main__":
    unittest.main()
