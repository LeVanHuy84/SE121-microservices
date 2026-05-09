from __future__ import annotations

import asyncio
import logging
import re
import time
from uuid import uuid4

from app.commands.assistant.persist_history_command import PersistHistoryCommand
from app.core.config import settings
from app.memory.session_memory import SessionMemory, session_memory
from app.providers.base import LlmGeneration, LlmProvider
from app.providers.groq_provider import GroqProvider
from app.schemas.assistant_schema import (
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
)
from app.services.context_resolver import (
    AssistantContextResolver,
    assistant_context_resolver,
)
from app.services.prompt_builder import PromptBuilder
from app.services.prompt_limits import resolve_prompt_limits
from app.services.scope_guard import AssistantScopeGuard, assistant_scope_guard

logger = logging.getLogger("uvicorn.error")
_LLM_SEMAPHORE = asyncio.Semaphore(max(settings.CHATBOT_MAX_CONCURRENT_LLM, 1))


class RespondCommand:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
        memory: SessionMemory | None = None,
        persist_history: PersistHistoryCommand | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or GroqProvider()
        self.context_resolver = context_resolver or assistant_context_resolver
        self.scope_guard = scope_guard or assistant_scope_guard
        self.memory = memory or session_memory
        self.persist_history = persist_history or PersistHistoryCommand()

    async def execute(self, request: AssistantRespondRequest) -> AssistantRespondData:
        started_at = time.perf_counter()
        request_id = str(uuid4())
        session_key = self._session_key(request)
        history = self._resolve_history(request, session_key)
        last_intent = request.intent or self.memory.get_last_intent(session_key)

        scope_decision = self.scope_guard.evaluate_scope(
            request,
            last_intent=last_intent,
            recent_history=history,
        )

        if scope_decision.reason == "greeting":
            data = self._greeting_response()
            self._persist_session_memory(request, data.reply, [], None)
            persisted = await self.persist_history.execute(
                request=request,
                assistant_reply=data.reply,
                sources=[],
                intent="greeting",
            )
            return data.model_copy(
                update={
                    "requestId": request_id,
                    "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                    "persisted": persisted,
                    "conversationId": request.conversationId or "default",
                }
            )

        if not scope_decision.in_scope:
            data = self._out_of_scope_response()
            self._persist_session_memory(request, data.reply, [], None)
            persisted = await self.persist_history.execute(
                request=request,
                assistant_reply=data.reply,
                sources=[],
                intent="out_of_scope",
            )
            return data.model_copy(
                update={
                    "requestId": request_id,
                    "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                    "persisted": persisted,
                    "conversationId": request.conversationId or "default",
                }
            )

        memory_summary = self.memory.get_summary(session_key)
        candidate_contexts = (
            self._dedupe_contexts(request.contexts)
            if request.contexts
            else await self._resolve_contexts_with_budget(
                request,
                settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
            )
        )
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
        generation: LlmGeneration
        try:
            async with _LLM_SEMAPHORE:
                generation = await asyncio.wait_for(
                    self.provider.generate(prompt, resolved_request),
                    timeout=max(llm_timeout_ms, 1) / 1000,
                )
        except asyncio.TimeoutError:
            generation = self._llm_timeout_generation()
        except Exception:
            logger.exception(
                "Assistant generation failed: userId=%s conversationId=%s contexts=%s",
                request.userId,
                request.conversationId,
                len(final_contexts),
            )
            raise

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
        persisted = await self.persist_history.execute(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=resolved_intent,
        )

        return AssistantRespondData(
            reply=reply_content,
            sources=sources,
            suggestedActions=[],
            model=generation.model,
            provider=generation.provider,
            requestId=request_id,
            latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
            persisted=persisted,
            conversationId=request.conversationId or "default",
        )

    def _resolve_history(self, request: AssistantRespondRequest, session_key: str):
        if request.history:
            return request.history[-settings.CHATBOT_MEMORY_RECENT_ITEMS :]
        return self.memory.get_recent(session_key, settings.CHATBOT_MEMORY_RECENT_ITEMS)

    def _session_key(self, request: AssistantRespondRequest) -> str:
        return f"{request.userId}:default"

    async def _resolve_contexts_with_budget(
        self,
        request: AssistantRespondRequest,
        timeout_ms: int,
    ):
        timeout_seconds = max(timeout_ms, 1) / 1000
        try:
            return await asyncio.wait_for(
                self.context_resolver.resolve(request),
                timeout=timeout_seconds,
            )
        except Exception:
            return self._dedupe_contexts(request.contexts)

    def _persist_session_memory(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ):
        session_key = self._session_key(request)
        memory_summary = self.memory.get_summary(session_key)
        self.memory.append_exchange(session_key, request.message, assistant_reply)
        self.memory.set_summary(
            session_key,
            self._build_updated_summary(
                memory_summary,
                request.message,
                assistant_reply,
            ),
        )
        self.memory.set_last_intent(session_key, intent)
        self.memory.set_last_sources(session_key, sources)

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
        return self._truncate_text(combined, settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT)

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
                "Hệ thống đang chậm hơn bình thường. "
                "Bạn thử gửi câu hỏi ngắn hơn hoặc thử lại sau vài giây."
            ),
            model="timeout-guard",
            provider="chatbot-service",
        )

    def _sanitize_assistant_reply(self, value: str) -> str:
        text = str(value or "").strip()
        if not text:
            return text
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
