from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import deque

from app.core.config import settings
from app.memory.session_memory import session_memory
from app.providers.base import LlmGeneration, LlmProvider
from app.providers.groq_provider import GroqProvider
from app.schemas.assistant_schema import (
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
)
from app.services.chat_history_service import chat_history_service
from app.services.context_resolver import (
    AssistantContextResolver,
    assistant_context_resolver,
)
from app.services.prompt_limits import resolve_prompt_limits
from app.services.prompt_builder import PromptBuilder
from app.services.scope_guard import (
    AssistantScopeGuard,
    assistant_scope_guard,
)

logger = logging.getLogger("uvicorn.error")


class AssistantService:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or self._resolve_provider()
        self.context_resolver = context_resolver or assistant_context_resolver
        self.scope_guard = scope_guard or assistant_scope_guard
        self._metrics_latencies: dict[str, deque[float]] = {}
        self._metrics_counters: dict[str, int] = {}
        self._metrics_respond_count = 0

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        session_key = self._session_key(request)
        history = self._resolve_history(request)
        last_intent = request.intent or session_memory.get_last_intent(session_key)

        scope_decision = self.scope_guard.evaluate_scope(
            request,
            last_intent=last_intent,
            recent_history=history,
        )

        if scope_decision.reason == "greeting":
            greeting_response = self._greeting_response()
            self._persist_session_memory(
                request=request,
                assistant_reply=greeting_response.reply,
                sources=[],
                intent=None,
            )
            await self._persist_history_before_response(
                request=request,
                assistant_reply=greeting_response.reply,
                sources=[],
                intent="greeting",
            )
            self._increment_metric_counter("respond_greeting")
            self._record_latency("respond.total_ms", 0.0)
            self._maybe_log_metrics_snapshot("greeting")
            return greeting_response

        if not scope_decision.in_scope:
            out_of_scope_response = self._out_of_scope_response()
            self._persist_session_memory(
                request=request,
                assistant_reply=out_of_scope_response.reply,
                sources=[],
                intent=None,
            )
            await self._persist_history_before_response(
                request=request,
                assistant_reply=out_of_scope_response.reply,
                sources=[],
                intent="out_of_scope",
            )
            self._increment_metric_counter("respond_out_of_scope")
            self._record_latency("respond.total_ms", 0.0)
            self._maybe_log_metrics_snapshot("out_of_scope")
            return out_of_scope_response

        started_at = time.perf_counter()
        memory_summary = session_memory.get_summary(session_key)

        context_started_at = time.perf_counter()
        candidate_contexts = await self._resolve_contexts_with_budget(
            request,
            settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
        )
        context_duration_ms = round((time.perf_counter() - context_started_at) * 1000, 2)
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]

        resolved_request = request.model_copy(update={"contexts": final_contexts})
        prompt = self.prompt_builder.build(
            resolved_request,
            history,
            memory_summary,
            context_char_limit=prompt_limits.context_char_limit,
            max_history_items=prompt_limits.max_history_items,
            history_item_char_limit=prompt_limits.history_item_char_limit,
            context_total_char_limit=prompt_limits.context_total_char_limit,
        )

        llm_timeout_ms = settings.CHATBOT_LLM_TIMEOUT_MS
        generation_started_at = time.perf_counter()
        try:
            generation = await asyncio.wait_for(
                self.provider.generate(prompt, resolved_request),
                timeout=max(llm_timeout_ms, 1) / 1000,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "Assistant generation timeout: userId=%s conversationId=%s llmTimeoutMs=%s",
                request.userId,
                request.conversationId,
                llm_timeout_ms,
            )
            self._increment_metric_counter("respond_llm_timeout")
            generation = self._llm_timeout_generation()
        except Exception:
            self._increment_metric_counter("respond_llm_error")
            logger.exception(
                "Assistant generation failed: userId=%s conversationId=%s contexts=%s",
                request.userId,
                request.conversationId,
                len(final_contexts),
            )
            raise
        generation_duration_ms = round(
            (time.perf_counter() - generation_started_at) * 1000, 2
        )
        total_duration_ms = round((time.perf_counter() - started_at) * 1000, 2)

        sources = [
            AssistantSource(
                type=item.type,
                id=item.id,
                title=item.title,
                source=item.source,
                score=item.score,
            )
            for item in final_contexts
        ]
        reply_content = self._sanitize_assistant_reply(generation.content)

        resolved_intent = request.intent or self._infer_intent(final_contexts)
        self._persist_session_memory(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=resolved_intent,
        )
        await self._persist_history_before_response(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=resolved_intent,
        )
        self._increment_metric_counter("respond_success")
        self._record_latency("respond.context_ms", context_duration_ms)
        self._record_latency("respond.llm_ms", generation_duration_ms)
        self._record_latency("respond.total_ms", total_duration_ms)
        self._maybe_log_metrics_snapshot("respond_success")

        return AssistantRespondData(
            reply=reply_content,
            sources=sources,
            suggestedActions=[],
            model=generation.model,
            provider=generation.provider,
        )

    def _resolve_history(self, request: AssistantRespondRequest):
        if request.history:
            return request.history[-settings.CHATBOT_MEMORY_RECENT_ITEMS :]
        return session_memory.get_recent(
            self._session_key(request),
            settings.CHATBOT_MEMORY_RECENT_ITEMS,
        )

    def _session_key(self, request: AssistantRespondRequest) -> str:
        return f"{request.userId}:default"

    def _resolve_provider(self) -> LlmProvider:
        return GroqProvider()

    async def _resolve_contexts_with_budget(
        self,
        request: AssistantRespondRequest,
        timeout_ms: int,
    ):
        timeout_seconds = max(timeout_ms, 1) / 1000
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(self.context_resolver.resolve, request),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            self._increment_metric_counter("respond_context_timeout")
            logger.warning(
                "Assistant context resolver timeout: userId=%s timeoutMs=%s",
                request.userId,
                timeout_ms,
            )
            return self._dedupe_contexts(request.contexts)
        except Exception as exc:
            self._increment_metric_counter("respond_context_error")
            logger.warning(
                "Assistant context resolver failed: userId=%s reason=%s",
                request.userId,
                exc,
            )
            return self._dedupe_contexts(request.contexts)

    def _persist_session_memory(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        session_key = self._session_key(request)
        memory_summary = session_memory.get_summary(session_key)
        session_memory.append_exchange(
            session_key,
            request.message,
            assistant_reply,
        )
        session_memory.set_summary(
            session_key,
            self._build_updated_summary(
                memory_summary,
                request.message,
                assistant_reply,
            ),
        )
        session_memory.set_last_intent(session_key, intent)
        session_memory.set_last_sources(session_key, sources)

    async def _persist_history_before_response(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        if not chat_history_service.is_enabled():
            return

        started_at = time.perf_counter()
        timeout_seconds = max(settings.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS, 1) / 1000
        try:
            persisted_exchange = await asyncio.wait_for(
                chat_history_service.append_exchange(
                    user_id=request.userId,
                    user_message=request.message,
                    assistant_reply=assistant_reply,
                    intent=intent,
                    sources=sources,
                ),
                timeout=timeout_seconds,
            )
            if persisted_exchange:
                user_chat_message, assistant_chat_message = persisted_exchange
                logger.info(
                    "Assistant history persisted: userId=%s userMessageId=%s assistantMessageId=%s userRole=%s assistantRole=%s",
                    request.userId,
                    user_chat_message.id,
                    assistant_chat_message.id,
                    user_chat_message.role,
                    assistant_chat_message.role,
                )
            self._increment_metric_counter("persist_history_success")
        except asyncio.TimeoutError as exc:
            self._increment_metric_counter("persist_history_timeout")
            logger.exception(
                "Assistant history persistence timeout: userId=%s timeoutMs=%s",
                request.userId,
                settings.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS,
            )
            raise RuntimeError("Assistant history persistence timeout") from exc
        except Exception:
            self._increment_metric_counter("persist_history_error")
            logger.exception(
                "Assistant history persistence failed: userId=%s",
                request.userId,
            )
            raise
        finally:
            self._record_latency(
                "persist.history_ms",
                round((time.perf_counter() - started_at) * 1000, 2),
            )

    def _build_updated_summary(
        self,
        current_summary: str,
        user_message: str,
        assistant_reply: str,
    ) -> str:
        latest = (
            "Lượt gần nhất: "
            f"Người dùng hỏi '{self._truncate_text(user_message, 180)}'. "
            f"Assistant trả lời '{self._truncate_text(assistant_reply, 260)}'."
        )
        combined = " ".join(part for part in [current_summary, latest] if part)
        return self._truncate_text(
            combined,
            settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT,
        )

    def _infer_intent(self, contexts) -> str | None:
        if not contexts:
            return None
        first_type = contexts[0].type
        if first_type in {"post", "group", "user", "help_doc"}:
            return first_type
        return None

    def _truncate_text(self, value: str, limit: int) -> str:
        normalized = " ".join(str(value or "").split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[:limit].rstrip()}..."

    def _metrics_enabled(self) -> bool:
        return settings.CHATBOT_METRICS_ENABLED

    def _increment_metric_counter(self, key: str):
        if not self._metrics_enabled():
            return
        self._metrics_counters[key] = self._metrics_counters.get(key, 0) + 1

    def _record_latency(self, metric: str, value_ms: float):
        if not self._metrics_enabled():
            return

        window_size = max(10, settings.CHATBOT_METRICS_WINDOW_SIZE)
        window = self._metrics_latencies.get(metric)
        if window is None or window.maxlen != window_size:
            window = deque(maxlen=window_size)
            self._metrics_latencies[metric] = window

        window.append(max(0.0, float(value_ms)))

    def _maybe_log_metrics_snapshot(self, reason: str):
        del reason
        return

    def _summarize_latency(self, metric: str) -> dict[str, float | int]:
        values = list(self._metrics_latencies.get(metric) or [])
        if not values:
            return {"count": 0, "p50": 0.0, "p95": 0.0, "p99": 0.0}

        values.sort()
        return {
            "count": len(values),
            "p50": self._percentile(values, 50),
            "p95": self._percentile(values, 95),
            "p99": self._percentile(values, 99),
        }

    def _percentile(self, sorted_values: list[float], percentile: int) -> float:
        if not sorted_values:
            return 0.0
        rank = int((percentile / 100) * len(sorted_values) + 0.999999) - 1
        index = max(0, min(rank, len(sorted_values) - 1))
        return round(float(sorted_values[index]), 2)

    def _dedupe_contexts(self, contexts):
        result = []
        seen: set[tuple[str, str]] = set()
        for item in contexts:
            key = (item.type, item.id)
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    def _llm_timeout_generation(self) -> LlmGeneration:
        return LlmGeneration(
            content=(
                "He thong dang cham hon binh thuong. "
                "Ban thu gui cau hoi ngan hon hoac thu lai sau vai giay."
            ),
            model="timeout-guard",
            provider="chatbot-service",
        )

    def _sanitize_assistant_reply(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return text

        # Some LLM outputs echo role labels like "assistant:" at the beginning.
        text = re.sub(
            r"^\s*(assistant|ai assistant|bot|assistant reply)\s*[:\-]\s*",
            "",
            text,
            flags=re.IGNORECASE,
        )
        return text.strip()

    def _out_of_scope_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Mình chỉ hỗ trợ các câu hỏi liên quan đến hệ thống Sentimeta "
                "như bài viết, nhóm, tìm kiếm, chat, hồ sơ, quyền riêng tư "
                "và gợi ý bạn bè."
            ),
            sources=[],
            suggestedActions=[],
            model="scope-guard",
            provider="chatbot-service",
        )

    def _greeting_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Xin chào! Mình là trợ lý của Sentimeta. "
                "Bạn cần mình hỗ trợ gì về bài viết, nhóm, chat, hồ sơ, tìm kiếm hoặc gợi ý bạn bè?"
            ),
            sources=[],
            suggestedActions=[],
            model="greeting-guard",
            provider="chatbot-service",
        )

assistant_service = AssistantService()
