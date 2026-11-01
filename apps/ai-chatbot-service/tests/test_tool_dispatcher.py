import asyncio
import unittest

from app.modules.chatbot.schemas import SurfaceContext
from app.modules.chatbot.tools.catalog import ALL_TOOLS
from app.modules.chatbot.tools.dispatcher import (
    ToolDispatcher,
    ToolExecutionContext,
    sanitize_tool_output,
    tool_dispatcher,
)


class ToolDispatcherTest(unittest.TestCase):
    def test_sanitize_tool_output_removes_sensitive_keys(self):
        dirty_data = {
            "name": "Sentimeta User",
            "email": "user@example.com",
            "phoneNumber": "0987654321",
            "password": "hashed_secret_password",
            "token": "bearer_jwt_token_123",
            "nested": {
                "secret": "confidential",
                "normalKey": "normalValue",
                "items": [
                    {"accessToken": "abc", "itemTitle": "Post 1"},
                ],
            },
        }

        sanitized = sanitize_tool_output(dirty_data)
        self.assertEqual(sanitized["name"], "Sentimeta User")
        self.assertNotIn("email", sanitized)
        self.assertNotIn("phoneNumber", sanitized)
        self.assertNotIn("password", sanitized)
        self.assertNotIn("token", sanitized)
        self.assertNotIn("secret", sanitized["nested"])
        self.assertEqual(sanitized["nested"]["normalKey"], "normalValue")
        self.assertNotIn("accessToken", sanitized["nested"]["items"][0])
        self.assertEqual(sanitized["nested"]["items"][0]["itemTitle"], "Post 1")

    def test_unregistered_tool_returns_error(self):
        ctx = ToolExecutionContext(user_id="user-1")
        res = asyncio.run(
            tool_dispatcher.dispatch("unknown_hack_tool", {}, ctx)
        )
        self.assertFalse(res.success)
        self.assertIn("không tồn tại", res.error)

    def test_tool_timeout_handling(self):
        dispatcher = ToolDispatcher(default_timeout_seconds=0.1)

        async def slow_handler(args, ctx):
            await asyncio.sleep(0.5)
            return {"data": "ok"}

        dispatcher.register_handler("get_my_friend_requests", slow_handler)
        ctx = ToolExecutionContext(user_id="user-1")
        res = asyncio.run(
            dispatcher.dispatch("get_my_friend_requests", {}, ctx)
        )
        self.assertFalse(res.success)
        self.assertIn("quá thời gian", res.error)

    def test_tool_exception_handling(self):
        dispatcher = ToolDispatcher()

        async def failing_handler(args, ctx):
            raise ValueError("Downstream service connection refused")

        dispatcher.register_handler("get_my_friend_requests", failing_handler)
        ctx = ToolExecutionContext(user_id="user-1")
        res = asyncio.run(
            dispatcher.dispatch("get_my_friend_requests", {}, ctx)
        )
        self.assertFalse(res.success)
        self.assertIn("Downstream service connection refused", res.error)

    def test_all_18_default_stubs_execute_cleanly(self):
        ctx = ToolExecutionContext(
            user_id="user-123",
            surface=SurfaceContext(screen="home"),
        )
        for tool_name in ALL_TOOLS.keys():
            res = asyncio.run(tool_dispatcher.dispatch(tool_name, {}, ctx))
            self.assertTrue(
                res.success,
                f"Tool {tool_name} failed with error: {res.error}",
            )
            self.assertIsNotNone(res.data)
            self.assertIsNone(res.error)
            # Check serialization to tool message content
            content = res.to_tool_message_content()
            self.assertIn('"status": "success"', content)


if __name__ == "__main__":
    unittest.main()
