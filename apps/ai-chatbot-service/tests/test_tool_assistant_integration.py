import asyncio
import os
import unittest
from typing import Any, AsyncIterator, Optional
from unittest.mock import MagicMock

os.environ.setdefault("INTERNAL_SERVICE_KEY", "test-internal-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("RAG_DOCS_ENABLED", "false")
os.environ["CHATBOT_DB_ENABLED"] = "false"

from app.modules.chatbot.navigation.resolver import NavDecision, NavResolver
from app.modules.chatbot.schemas import AssistantRespondRequest, SurfaceContext
from app.modules.chatbot.services.assistant import RespondCommand
from app.modules.chatbot.tools.dispatcher import ToolDispatcher
from app.modules.chatbot.tools.router import ToolRouter
from app.providers.base import LlmChunk, LlmGeneration, ToolCallInfo


class MockToolCallingProvider:
    def __init__(self, should_call_tool: bool = True):
        self.should_call_tool = should_call_tool
        self.generate_calls: list[dict[str, Any]] = []

    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> LlmGeneration:
        self.generate_calls.append({"prompt": prompt, "tools": tools})
        # First call with tools:
        if tools and self.should_call_tool and len(self.generate_calls) == 1:
            return LlmGeneration(
                content="",
                model="test-groq-model",
                provider="groq",
                tool_calls=(
                    ToolCallInfo(
                        id="call_abc123",
                        name="get_my_friend_requests",
                        args={"limit": 5},
                    ),
                ),
            )
        # Second call (synthesis) or direct reply:
        return LlmGeneration(
            content="Bạn hiện có 1 lời mời kết bạn từ Nguyễn Văn A.",
            model="test-groq-model",
            provider="groq",
            tool_calls=(),
        )

    async def stream(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> AsyncIterator[LlmChunk]:
        yield LlmChunk(content="Bạn hiện có ", model="test-groq-model", provider="groq")
        yield LlmChunk(content="1 lời mời kết bạn.", model="test-groq-model", provider="groq")


class ToolAssistantIntegrationTest(unittest.TestCase):
    def setUp(self):
        # Create a nav_resolver mock that does not short-circuit to navigation
        self.mock_nav_resolver = MagicMock(spec=NavResolver)
        self.mock_nav_resolver.resolve.return_value = NavDecision(
            path="none",
            matches=[],
            suggested_reply=None,
        )

    def test_execute_triggers_tool_call_and_synthesis(self):
        provider = MockToolCallingProvider(should_call_tool=True)
        command = RespondCommand(
            provider=provider,
            tool_router_instance=ToolRouter(),
            tool_dispatcher_instance=ToolDispatcher(),
            nav_resolver_instance=self.mock_nav_resolver,
        )

        req = AssistantRespondRequest(
            userId="user-123",
            message="Xem giúp tôi ai đang gửi lời mời kết bạn",
            surface=SurfaceContext(screen="friends.requests"),
        )

        res = asyncio.run(command.execute(req))
        self.assertEqual(len(provider.generate_calls), 2)
        # First call passed routed tools
        self.assertIsNotNone(provider.generate_calls[0]["tools"])
        # Second call received prompt with injected tool output
        self.assertIn("[KẾT QUẢ TRẢ VỀ TỪ CÔNG CỤ HỆ THỐNG]", provider.generate_calls[1]["prompt"])
        self.assertIn("Nguyễn Văn A", provider.generate_calls[1]["prompt"])
        self.assertIn("Bạn hiện có 1 lời mời kết bạn", res.reply)

    def test_execute_stream_triggers_tool_call_and_streams_synthesis(self):
        provider = MockToolCallingProvider(should_call_tool=True)
        command = RespondCommand(
            provider=provider,
            tool_router_instance=ToolRouter(),
            tool_dispatcher_instance=ToolDispatcher(),
            nav_resolver_instance=self.mock_nav_resolver,
        )

        req = AssistantRespondRequest(
            userId="user-123",
            message="Ai gửi lời mời kết bạn?",
            surface=SurfaceContext(screen="friends"),
        )

        async def collect_stream():
            chunks = []
            async for chunk in command.execute_stream(req):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(collect_stream())
        self.assertGreater(len(chunks), 0)
        full_text = "".join(c.reply for c in chunks)
        self.assertEqual(full_text, "Bạn hiện có 1 lời mời kết bạn.")

    def test_crisis_guard_precedence_aborts_tool_routing(self):
        """CRITICAL SAFETY INVARIANT: CrisisGuard must ALWAYS execute before tools and abort them."""
        provider = MockToolCallingProvider(should_call_tool=True)
        command = RespondCommand(
            provider=provider,
            tool_router_instance=ToolRouter(),
            tool_dispatcher_instance=ToolDispatcher(),
            nav_resolver_instance=self.mock_nav_resolver,
        )

        req = AssistantRespondRequest(
            userId="user-123",
            message="Tôi muốn tự tử và kết thúc cuộc sống này ngay bây giờ",
            surface=SurfaceContext(screen="friends.requests"),
        )

        res = asyncio.run(command.execute(req))
        # Provider and tools must NOT be invoked at all
        self.assertEqual(len(provider.generate_calls), 0)
        self.assertEqual(res.type, "crisis")
        self.assertIn("1900 599 830", res.reply)

    def test_execute_handles_multiple_concurrent_tools(self):
        """Validates that multiple tool calls in a single turn are executed concurrently and injected."""
        class MultiToolProvider(MockToolCallingProvider):
            async def generate(self, prompt, request, tools=None):
                self.generate_calls.append({"prompt": prompt, "tools": tools})
                if len(self.generate_calls) == 1:
                    return LlmGeneration(
                        content="",
                        model="test-groq-model",
                        provider="groq",
                        tool_calls=(
                            ToolCallInfo(id="call_1", name="get_my_friend_requests", args={"limit": 5}),
                            ToolCallInfo(id="call_2", name="get_my_unread_notifications", args={"limit": 3}),
                        ),
                    )
                return LlmGeneration(
                    content="Tổng hợp: Bạn có lời mời và thông báo mới.",
                    model="test-groq-model",
                    provider="groq",
                    tool_calls=(),
                )

        provider = MultiToolProvider()
        command = RespondCommand(
            provider=provider,
            tool_router_instance=ToolRouter(),
            tool_dispatcher_instance=ToolDispatcher(),
            nav_resolver_instance=self.mock_nav_resolver,
        )

        req = AssistantRespondRequest(
            userId="user-123",
            message="Tổng hợp tin tức và bạn bè cho tôi",
            surface=SurfaceContext(screen="home"),
        )

        res = asyncio.run(command.execute(req))
        self.assertEqual(len(provider.generate_calls), 2)
        second_prompt = provider.generate_calls[1]["prompt"]
        self.assertIn("get_my_friend_requests", second_prompt)
        self.assertIn("get_my_unread_notifications", second_prompt)
        self.assertIn("Tổng hợp: Bạn có lời mời và thông báo mới.", res.reply)


if __name__ == "__main__":
    unittest.main()
