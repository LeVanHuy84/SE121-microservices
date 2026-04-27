from __future__ import annotations

import asyncio
import logging
import time

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
from app.services.scope_guard import AssistantScopeGuard, assistant_scope_guard

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
        self._background_tasks: set[asyncio.Task[None]] = set()

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        if not self.scope_guard.is_in_scope(request):
            out_of_scope_response = self._out_of_scope_response()
            self._persist_session_memory(
                request=request,
                assistant_reply=out_of_scope_response.reply,
                sources=[],
                intent="out_of_scope",
            )
            self._persist_history_in_background(
                request=request,
                assistant_reply=out_of_scope_response.reply,
                sources=[],
                intent="out_of_scope",
            )
            return out_of_scope_response

        started_at = time.perf_counter()
        session_key = self._session_key(request)
        history = self._resolve_history(request)
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
            generation = self._llm_timeout_generation()
        except Exception:
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

        resolved_intent = request.intent or self._infer_intent(final_contexts)
        self._persist_session_memory(
            request=request,
            assistant_reply=generation.content,
            sources=sources,
            intent=resolved_intent,
        )
        self._persist_history_in_background(
            request=request,
            assistant_reply=generation.content,
            sources=sources,
            intent=resolved_intent,
        )

        logger.info(
            "Assistant response generated: userId=%s provider=%s model=%s candidateContexts=%s finalContexts=%s promptVariant=%s contextMs=%s llmMs=%s durationMs=%s",
            request.userId,
            generation.provider,
            generation.model,
            len(candidate_contexts),
            len(final_contexts),
            prompt_limits.variant,
            context_duration_ms,
            generation_duration_ms,
            round((time.perf_counter() - started_at) * 1000, 2),
        )

        return AssistantRespondData(
            reply=generation.content,
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
            logger.warning(
                "Assistant context resolver timeout: userId=%s timeoutMs=%s",
                request.userId,
                timeout_ms,
            )
            return self._dedupe_contexts(request.contexts)
        except Exception as exc:
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

    async def _persist_history_best_effort(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        if not chat_history_service.is_enabled():
            return

        try:
            await chat_history_service.append_exchange(
                user_id=request.userId,
                user_message=request.message,
                assistant_reply=assistant_reply,
                intent=intent,
                sources=sources,
            )
        except Exception:
            logger.exception(
                "Assistant history persistence failed: userId=%s",
                request.userId,
            )

    def _persist_history_in_background(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        if not chat_history_service.is_enabled():
            return

        task = asyncio.create_task(
            self._persist_history_best_effort(
                request=request,
                assistant_reply=assistant_reply,
                sources=sources,
                intent=intent,
            )
        )
        self._background_tasks.add(task)
        task.add_done_callback(self._on_background_task_done)

    def _on_background_task_done(self, task: asyncio.Task[None]):
        self._background_tasks.discard(task)
        if task.cancelled():
            return
        try:
            task.result()
        except Exception:
            logger.exception("Assistant background task failed")

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


assistant_service = AssistantService()
