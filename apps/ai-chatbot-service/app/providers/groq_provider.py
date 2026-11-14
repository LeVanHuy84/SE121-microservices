from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncIterator, Optional, Sequence

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.providers.base import LlmChunk, LlmGeneration, ToolCallInfo

logger = logging.getLogger("uvicorn.error")


def _is_transient_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    transient_indicators = (
        "429",
        "rate limit",
        "503",
        "timeout",
        "connection error",
        "service unavailable",
    )
    return any(ind in msg for ind in transient_indicators)


class GroqProvider:
    def __init__(self):
        self._llm_cache: dict[tuple[str, float, bool], Any] = {}

    async def generate(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
    ) -> LlmGeneration:
        temperature = self._resolve_temperature(request)
        resolved_model = model or settings.GROQ_MODEL
        llm = self._get_llm(temperature, model=resolved_model, json_mode=json_mode)
        messages = self._coerce_messages(prompt)

        if tools:
            llm_with_tools = llm.bind_tools(tools)
            for attempt in range(2):
                try:
                    ai_msg = await llm_with_tools.ainvoke(messages)
                    tool_calls: list[ToolCallInfo] = []
                    if hasattr(ai_msg, "tool_calls") and ai_msg.tool_calls:
                        for tc in ai_msg.tool_calls:
                            if isinstance(tc, dict):
                                tool_calls.append(
                                    ToolCallInfo(
                                        id=tc.get("id", ""),
                                        name=tc.get("name", ""),
                                        args=tc.get("args") or {},
                                    )
                                )
                            else:
                                tool_calls.append(
                                    ToolCallInfo(
                                        id=getattr(tc, "id", ""),
                                        name=getattr(tc, "name", ""),
                                        args=getattr(tc, "args", {}) or {},
                                    )
                                )
                    return LlmGeneration(
                        content=str(getattr(ai_msg, "content", ai_msg) or "").strip(),
                        model=resolved_model,
                        provider="groq",
                        tool_calls=tuple(tool_calls),
                    )
                except Exception as exc:
                    if (
                        "tool_use_failed" in str(exc).lower()
                        or "400" in str(exc).lower()
                    ):
                        logger.warning(
                            "Groq tool_use_failed error, falling back to tool-free: %s",
                            exc,
                        )
                        fallback_msg = await llm.ainvoke(messages)
                        return LlmGeneration(
                            content=str(
                                getattr(fallback_msg, "content", fallback_msg) or ""
                            ).strip(),
                            model=resolved_model,
                            provider="groq",
                            tool_calls=(),
                        )
                    if attempt < 1 and _is_transient_error(exc):
                        await asyncio.sleep(0.5 * (2**attempt))
                        continue
                    raise
            raise RuntimeError("Groq retry limit exceeded")

        for attempt in range(2):
            try:
                ai_msg = await llm.ainvoke(messages)
                content = str(getattr(ai_msg, "content", ai_msg) or "").strip()
                if not content:
                    raise RuntimeError("Groq returned an empty response")
                return LlmGeneration(
                    content=content,
                    model=resolved_model,
                    provider="groq",
                    tool_calls=(),
                )
            except Exception as exc:
                if attempt < 1 and _is_transient_error(exc):
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise
        raise RuntimeError("Groq retry limit exceeded")

    async def stream(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
    ) -> AsyncIterator[LlmChunk]:
        temperature = self._resolve_temperature(request)
        if not settings.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")

        resolved_model = model or settings.GROQ_MODEL
        llm = self._get_llm(temperature, model=resolved_model, json_mode=json_mode)
        messages = self._coerce_messages(prompt)
        active_llm = llm.bind_tools(tools) if tools else llm

        for attempt in range(2):
            first_chunk = True
            accumulated: Any = None
            try:
                async for chunk in active_llm.astream(messages):
                    first_chunk = False
                    accumulated = chunk if accumulated is None else accumulated + chunk
                    delta = getattr(chunk, "content", chunk)
                    if delta:
                        yield LlmChunk(
                            content=str(delta),
                            model=resolved_model,
                            provider="groq",
                        )

                if tools and accumulated is not None:
                    raw_calls = getattr(accumulated, "tool_calls", None) or []
                    if raw_calls:
                        parsed_calls: list[ToolCallInfo] = []
                        for tc in raw_calls:
                            if isinstance(tc, dict):
                                parsed_calls.append(
                                    ToolCallInfo(
                                        id=tc.get("id", ""),
                                        name=tc.get("name", ""),
                                        args=tc.get("args") or {},
                                    )
                                )
                            else:
                                parsed_calls.append(
                                    ToolCallInfo(
                                        id=getattr(tc, "id", ""),
                                        name=getattr(tc, "name", ""),
                                        args=getattr(tc, "args", {}) or {},
                                    )
                                )
                        yield LlmChunk(
                            content="",
                            model=resolved_model,
                            provider="groq",
                            tool_calls=tuple(parsed_calls),
                        )
                return
            except Exception as exc:
                if (
                    tools
                    and first_chunk
                    and (
                        "tool_use_failed" in str(exc).lower()
                        or "400" in str(exc).lower()
                    )
                ):
                    logger.warning(
                        "Groq tool binding failed during stream, retrying without tools: %s",
                        exc,
                    )
                    active_llm = llm
                    tools = None
                    continue
                if first_chunk and attempt < 1 and _is_transient_error(exc):
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise

    def _coerce_messages(self, prompt_or_messages: str | Sequence[Any]) -> list[Any]:
        if isinstance(prompt_or_messages, str):
            try:
                from langchain_core.messages import HumanMessage, SystemMessage
            except ImportError as exc:
                raise RuntimeError("LangChain dependencies are not installed.") from exc
            return [
                SystemMessage(
                    content=(
                        "Tuân thủ hệ thống trong prompt. "
                        "Chỉ dùng thông tin trong prompt/context, không bịa dữ liệu."
                    )
                ),
                HumanMessage(content=prompt_or_messages),
            ]
        return list(prompt_or_messages)

    def _get_llm(
        self, temperature: float, model: str | None = None, json_mode: bool = False
    ):
        try:
            from langchain_groq import ChatGroq
        except ImportError as exc:
            raise RuntimeError(
                "LangChain Groq dependencies are not installed. "
                "Run: pip install -r requirements.txt"
            ) from exc

        resolved_model = model or settings.GROQ_MODEL
        cache_key = (resolved_model, round(float(temperature), 2), bool(json_mode))
        cached = self._llm_cache.get(cache_key)
        if cached is not None:
            return cached

        model_kwargs = {"response_format": {"type": "json_object"}} if json_mode else {}
        llm = ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model=resolved_model,
            temperature=round(float(temperature), 2),
            max_tokens=settings.GROQ_MAX_TOKENS,
            timeout=settings.GROQ_TIMEOUT_SECONDS,
            max_retries=0,
            model_kwargs=model_kwargs,
        )
        self._llm_cache[cache_key] = llm
        return llm

    def _resolve_temperature(self, request: AssistantRespondRequest) -> float:
        # Task-oriented turns should be more deterministic.
        if request.intent or request.contexts:
            return settings.GROQ_TEMPERATURE_TASK
        return settings.GROQ_TEMPERATURE
