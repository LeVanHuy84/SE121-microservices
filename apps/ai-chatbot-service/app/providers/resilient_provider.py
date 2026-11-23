from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator, Optional, Sequence

import httpx

from app.core.settings import settings
from app.modules.chatbot.schemas import AssistantRespondRequest
from app.providers.base import LlmChunk, LlmGeneration, LlmProvider
from app.providers.groq_provider import GroqProvider

logger = logging.getLogger("uvicorn.error")

STREAM_TRUNCATION_NOTICE = (
    "\n\n*(Kết nối gián đoạn tạm thời — bạn nhắn tiếp để mình hỗ trợ nhé.)*"
)


class CircuitOpenSkippedError(RuntimeError):
    """Raised when a low-priority background job is skipped due to open circuit."""


def _is_rate_limit_error(exc: Exception) -> bool:
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return "ratelimit" in name or "429" in msg or "rate limit" in msg


def _coerce_openai_messages(
    prompt_or_messages: str | Sequence[Any],
) -> list[dict[str, str]]:
    if isinstance(prompt_or_messages, str):
        return [
            {
                "role": "system",
                "content": (
                    "Tuân thủ hệ thống trong prompt. "
                    "Chỉ dùng thông tin trong prompt/context, không bịa dữ liệu."
                ),
            },
            {"role": "user", "content": prompt_or_messages},
        ]

    messages: list[dict[str, str]] = []
    for item in prompt_or_messages:
        if isinstance(item, dict):
            role = str(item.get("role") or "user")
            content = str(item.get("content") or "")
        else:
            msg_type = str(getattr(item, "type", "human")).lower()
            role = {
                "system": "system",
                "ai": "assistant",
                "assistant": "assistant",
                "human": "user",
                "user": "user",
            }.get(msg_type, "user")
            content = str(getattr(item, "content", "") or "")
        if content:
            messages.append({"role": role, "content": content})
    return messages


class OpenAICompatibleFallbackProvider:
    """HTTPX-based provider for OpenAI-compatible APIs such as Gemini or Ollama."""

    supports_chat_messages: bool = True

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        provider_name: str | None = None,
        timeout_seconds: float = 15.0,
    ) -> None:
        self.api_key = (
            settings.LLM_FALLBACK_API_KEY if api_key is None else api_key
        ).strip()
        self.base_url = (
            settings.LLM_FALLBACK_BASE_URL if base_url is None else base_url
        ).rstrip("/")
        self.model = settings.LLM_FALLBACK_MODEL if model is None else model
        self.provider_name = provider_name or settings.LLM_FALLBACK_PROVIDER or "gemini"
        self.timeout_seconds = timeout_seconds
        self._client: httpx.AsyncClient | None = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout_seconds)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
        self._client = None

    @property
    def is_enabled(self) -> bool:
        return bool(self.api_key)

    def _resolve_temperature(self, request: AssistantRespondRequest) -> float:
        mode = getattr(request, "mode", None) or "chat"
        if mode == "task":
            return settings.GROQ_TEMPERATURE_TASK
        return settings.GROQ_TEMPERATURE

    def _build_payload(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        *,
        resolved_model: str,
        stream: bool,
        json_mode: bool,
    ) -> dict[str, Any]:
        is_gemini_25 = (
            self.provider_name.lower() == "gemini"
            or "gemini-2.5" in resolved_model.lower()
        )
        max_tokens = (
            max(settings.GROQ_MAX_TOKENS, 2048)
            if is_gemini_25
            else settings.GROQ_MAX_TOKENS
        )
        payload: dict[str, Any] = {
            "model": resolved_model,
            "messages": _coerce_openai_messages(prompt),
            "temperature": self._resolve_temperature(request),
            "max_tokens": max_tokens,
            "stream": stream,
        }
        # Gemini 2.5 shares max_tokens between hidden thinking and visible output;
        # disable thinking on chat fallback so replies are neither truncated nor slow.
        if is_gemini_25 and "gemini-2.5-flash" in resolved_model.lower():
            payload["reasoning_effort"] = "none"
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    async def generate(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
        allow_paid_fallback: bool = True,
    ) -> LlmGeneration:
        del tools, allow_paid_fallback
        if not self.is_enabled:
            raise RuntimeError("Fallback LLM provider API key is not configured")

        resolved_model = model or self.model
        payload = self._build_payload(
            prompt,
            request,
            resolved_model=resolved_model,
            stream=False,
            json_mode=json_mode,
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        client = self._get_client()
        resp = await client.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

        choices = data.get("choices") or []
        content = ""
        finish_reason: str | None = None
        if choices:
            content = str(
                (choices[0].get("message") or {}).get("content") or ""
            ).strip()
            finish_reason = choices[0].get("finish_reason")
        return LlmGeneration(
            content=content,
            model=resolved_model,
            provider=self.provider_name,
            tool_calls=(),
            finish_reason=finish_reason,
        )

    async def stream(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
    ) -> AsyncIterator[LlmChunk]:
        del tools
        if not self.is_enabled:
            raise RuntimeError("Fallback LLM provider API key is not configured")

        resolved_model = model or self.model
        payload = self._build_payload(
            prompt,
            request,
            resolved_model=resolved_model,
            stream=True,
            json_mode=json_mode,
        )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        client = self._get_client()
        async with client.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers=headers,
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    break
                try:
                    chunk_data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                choices = chunk_data.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield LlmChunk(
                        content=str(delta),
                        model=resolved_model,
                        provider=self.provider_name,
                    )


class ResilientLlmProvider:
    """Circuit-breaker-protected multi-provider wrapper (Groq primary -> Gemini/OpenAI fallback)."""

    supports_chat_messages: bool = True

    def __init__(
        self,
        primary: LlmProvider | None = None,
        fallback: OpenAICompatibleFallbackProvider | None = None,
        failure_threshold: int | None = None,
        cooldown_seconds: float | None = None,
    ) -> None:
        self.fallback: OpenAICompatibleFallbackProvider = (
            fallback or OpenAICompatibleFallbackProvider()
        )
        self.primary: LlmProvider = primary or GroqProvider(
            bypass_retry=self.fallback.is_enabled
        )
        self.failure_threshold = (
            failure_threshold
            if failure_threshold is not None
            else settings.LLM_CIRCUIT_BREAKER_FAILURE_THRESHOLD
        )
        self.cooldown_seconds = (
            cooldown_seconds
            if cooldown_seconds is not None
            else settings.LLM_CIRCUIT_BREAKER_COOLDOWN_SECONDS
        )
        self._state: str = "CLOSED"
        self._consecutive_failures: int = 0
        self._first_failure_at: float = 0.0
        self._opened_until: float = 0.0
        self._probe_lock = asyncio.Lock()
        self._probe_in_flight: bool = False

    @property
    def circuit_state(self) -> str:
        if self._state == "OPEN" and time.monotonic() >= self._opened_until:
            self._state = "HALF_OPEN"
        return self._state

    def _record_success(self) -> None:
        self._state = "CLOSED"
        self._consecutive_failures = 0
        self._first_failure_at = 0.0
        self._opened_until = 0.0

    def _record_failure(self, exc: Exception) -> None:
        now = time.monotonic()
        if _is_rate_limit_error(exc) or self._state == "HALF_OPEN":
            self._state = "OPEN"
            cooldown = (
                min(self.cooldown_seconds, 15.0)
                if _is_rate_limit_error(exc)
                else self.cooldown_seconds
            )
            self._opened_until = now + cooldown
            self._consecutive_failures = self.failure_threshold
            logger.warning(
                "[ResilientLLM] Circuit breaker tripped to OPEN for %.1fs (%s)",
                cooldown,
                exc,
            )
            return

        if now - self._first_failure_at > 60.0:
            self._consecutive_failures = 0
            self._first_failure_at = now
        if self._consecutive_failures == 0:
            self._first_failure_at = now
        self._consecutive_failures += 1

        if self._consecutive_failures >= self.failure_threshold:
            self._state = "OPEN"
            self._opened_until = now + self.cooldown_seconds
            logger.warning(
                "[ResilientLLM] Circuit breaker tripped to OPEN after %d failures (%s)",
                self._consecutive_failures,
                exc,
            )

    async def generate(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
        allow_paid_fallback: bool = True,
    ) -> LlmGeneration:
        state = self.circuit_state

        if not allow_paid_fallback and state != "CLOSED":
            raise CircuitOpenSkippedError(
                f"Background generation skipped while circuit is {state}"
            )

        if state == "OPEN":
            if allow_paid_fallback and self.fallback.is_enabled:
                return await self.fallback.generate(
                    prompt, request, tools=tools, model=None, json_mode=json_mode
                )
            raise CircuitOpenSkippedError("Primary LLM circuit breaker is OPEN")

        if state == "HALF_OPEN":
            async with self._probe_lock:
                if self._probe_in_flight:
                    if allow_paid_fallback and self.fallback.is_enabled:
                        return await self.fallback.generate(
                            prompt,
                            request,
                            tools=tools,
                            model=None,
                            json_mode=json_mode,
                        )
                    raise CircuitOpenSkippedError(
                        "Primary LLM circuit breaker probe already in flight"
                    )
                self._probe_in_flight = True
            try:
                res = await self.primary.generate(
                    prompt, request, tools=tools, model=model, json_mode=json_mode
                )
                self._record_success()
                return res
            except Exception as exc:
                self._record_failure(exc)
                if allow_paid_fallback and self.fallback.is_enabled:
                    return await self.fallback.generate(
                        prompt, request, tools=tools, model=None, json_mode=json_mode
                    )
                raise
            finally:
                self._probe_in_flight = False

        # CLOSED state
        try:
            res = await self.primary.generate(
                prompt, request, tools=tools, model=model, json_mode=json_mode
            )
            self._record_success()
            return res
        except Exception as exc:
            self._record_failure(exc)
            if allow_paid_fallback and self.fallback.is_enabled:
                return await self.fallback.generate(
                    prompt, request, tools=tools, model=None, json_mode=json_mode
                )
            raise

    async def stream(
        self,
        prompt: str | Sequence[Any],
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
        model: Optional[str] = None,
        json_mode: bool = False,
    ) -> AsyncIterator[LlmChunk]:
        state = self.circuit_state

        if state == "OPEN":
            if self.fallback.is_enabled:
                async for chunk in self.fallback.stream(
                    prompt, request, tools=tools, model=None, json_mode=json_mode
                ):
                    yield chunk
                return
            raise CircuitOpenSkippedError("Primary LLM circuit breaker is OPEN")

        acquired_probe = False
        if state == "HALF_OPEN":
            async with self._probe_lock:
                if self._probe_in_flight:
                    if self.fallback.is_enabled:
                        async for chunk in self.fallback.stream(
                            prompt,
                            request,
                            tools=tools,
                            model=None,
                            json_mode=json_mode,
                        ):
                            yield chunk
                        return
                    raise CircuitOpenSkippedError(
                        "Primary LLM circuit breaker probe already in flight"
                    )
                self._probe_in_flight = True
                acquired_probe = True

        first_chunk_emitted = False
        try:
            async for chunk in self.primary.stream(
                prompt, request, tools=tools, model=model, json_mode=json_mode
            ):
                first_chunk_emitted = True
                yield chunk
            self._record_success()
        except Exception as exc:
            self._record_failure(exc)
            if not first_chunk_emitted:
                if self.fallback.is_enabled:
                    async for f_chunk in self.fallback.stream(
                        prompt, request, tools=tools, model=None, json_mode=json_mode
                    ):
                        yield f_chunk
                    return
                raise
            yield LlmChunk(
                content=STREAM_TRUNCATION_NOTICE,
                model=model or settings.GROQ_MODEL,
                provider="groq",
            )
        finally:
            if acquired_probe:
                self._probe_in_flight = False


resilient_llm_provider = ResilientLlmProvider()


def get_default_llm_provider() -> LlmProvider:
    if settings.CHATBOT_LLM_STUB_MODE:
        from app.providers.stub_provider import StubLlmProvider

        return StubLlmProvider()
    if settings.CHATBOT_LLM_PROVIDER == "ollama":
        return OpenAICompatibleFallbackProvider(
            api_key="ollama",
            base_url=settings.OLLAMA_BASE_URL,
            model=settings.OLLAMA_MODEL,
            provider_name="ollama",
        )
    if settings.LLM_FALLBACK_ENABLED:
        return resilient_llm_provider
    return GroqProvider()
