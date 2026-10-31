from __future__ import annotations

import asyncio
from typing import AsyncIterator

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.providers.base import LlmChunk, LlmGeneration


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
        self._chains: dict[float, object] = {}

    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> LlmGeneration:
        temperature = self._resolve_temperature(request)
        content = await self._generate_async(prompt, temperature)
        return LlmGeneration(
            content=content,
            model=settings.GROQ_MODEL,
            provider="groq",
        )

    async def stream(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> AsyncIterator[LlmChunk]:
        temperature = self._resolve_temperature(request)
        if not settings.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")

        chain = self._get_chain(temperature)
        for attempt in range(3):
            first_chunk = True
            try:
                async for chunk in chain.astream({"input": prompt}):
                    first_chunk = False
                    yield LlmChunk(
                        content=str(chunk or ""),
                        model=settings.GROQ_MODEL,
                        provider="groq",
                    )
                return
            except Exception as exc:
                if first_chunk and attempt < 2 and _is_transient_error(exc):
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise

    async def _generate_async(self, prompt: str, temperature: float) -> str:
        if not settings.GROQ_API_KEY:
            raise RuntimeError("GROQ_API_KEY is not set")

        chain = self._get_chain(temperature)
        for attempt in range(3):
            try:
                response = await chain.ainvoke({"input": prompt})
                response = str(response or "").strip()
                if not response:
                    raise RuntimeError("Groq returned an empty response")
                return response
            except Exception as exc:
                if attempt < 2 and _is_transient_error(exc):
                    await asyncio.sleep(0.5 * (2**attempt))
                    continue
                raise
        raise RuntimeError("Groq retry limit exceeded")

    def _get_chain(self, temperature: float):
        cache_key = round(float(temperature), 3)
        cached = self._chains.get(cache_key)
        if cached is not None:
            return cached

        try:
            from langchain_core.output_parsers import StrOutputParser
            from langchain_core.prompts import ChatPromptTemplate
            from langchain_groq import ChatGroq
        except ImportError as exc:
            raise RuntimeError(
                "LangChain Groq dependencies are not installed. "
                "Run: pip install -r requirements.txt"
            ) from exc

        llm = ChatGroq(
            api_key=settings.GROQ_API_KEY,
            model=settings.GROQ_MODEL,
            temperature=cache_key,
            max_tokens=settings.GROQ_MAX_TOKENS,
            timeout=settings.GROQ_TIMEOUT_SECONDS,
        )
        prompt_template = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    (
                        "Tuân thủ hệ thống trong prompt. "
                        "Chỉ dùng thông tin trong prompt/context, không bịa dữ liệu."
                    ),
                ),
                ("human", "{input}"),
            ]
        )
        chain = prompt_template | llm | StrOutputParser()
        self._chains[cache_key] = chain
        return chain

    def _resolve_temperature(self, request: AssistantRespondRequest) -> float:
        # Task-oriented turns should be more deterministic.
        if request.intent or request.contexts:
            return settings.GROQ_TEMPERATURE_TASK
        return settings.GROQ_TEMPERATURE

