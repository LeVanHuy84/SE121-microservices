import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.providers.groq_provider import EMPTY_RESPONSE_ERROR, GroqProvider


def _request():
    return SimpleNamespace(emotion=None, context=None)


def _provider_with(responses):
    provider = GroqProvider()
    llm = MagicMock()
    llm_with_tools = MagicMock()
    llm_with_tools.ainvoke = AsyncMock(side_effect=responses)
    llm.bind_tools.return_value = llm_with_tools
    llm.ainvoke = AsyncMock(side_effect=responses)
    return provider, llm


class GroqEmptyResponseTests(unittest.IsolatedAsyncioTestCase):
    async def _run(self, provider, llm, tools):
        with patch.object(provider, "_get_llm", return_value=llm), patch.object(
            provider, "_resolve_temperature", return_value=0.3
        ), patch("asyncio.sleep", new=AsyncMock()):
            return await provider.generate("hi", _request(), tools=tools)

    async def test_tool_path_retries_empty_then_succeeds(self):
        empty = SimpleNamespace(content="  ", tool_calls=[])
        ok = SimpleNamespace(content="xin chào", tool_calls=[])
        provider, llm = _provider_with([empty, ok])
        result = await self._run(provider, llm, tools=[{"name": "t"}])
        self.assertEqual(result.content, "xin chào")

    async def test_tool_path_raises_when_always_empty(self):
        empty = SimpleNamespace(content="", tool_calls=[])
        provider, llm = _provider_with([empty, empty])
        with self.assertRaisesRegex(RuntimeError, EMPTY_RESPONSE_ERROR):
            await self._run(provider, llm, tools=[{"name": "t"}])

    async def test_tool_call_without_text_is_valid(self):
        msg = SimpleNamespace(
            content="",
            tool_calls=[{"id": "1", "name": "friends", "args": {}}],
        )
        provider, llm = _provider_with([msg])
        result = await self._run(provider, llm, tools=[{"name": "friends"}])
        self.assertEqual(len(result.tool_calls), 1)

    async def test_tool_free_path_rejects_empty(self):
        empty = SimpleNamespace(content="", tool_calls=[])
        provider, llm = _provider_with([empty, empty])
        with self.assertRaisesRegex(RuntimeError, EMPTY_RESPONSE_ERROR):
            await self._run(provider, llm, tools=None)


if __name__ == "__main__":
    unittest.main()
