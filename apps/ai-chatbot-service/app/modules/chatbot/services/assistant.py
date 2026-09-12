from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from uuid import uuid4

from app.core.settings import settings
from app.modules.chatbot.repositories.chat_history import PersistHistoryCommand
from app.modules.chatbot.schemas import (
    AssistantHistoryItem,
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
)
from app.modules.chatbot.services.context_resolver import (
    AssistantContextResolver,
    assistant_context_resolver,
)
from app.modules.chatbot.services.guardrails import (
    AssistantScopeGuard,
    CommunityGuard,
    ScopeDecision,
    assistant_community_guard,
    assistant_scope_guard,
)
from app.modules.chatbot.services.memory import SessionMemory, session_memory
from app.modules.chatbot.services.prompt_builder import PromptBuilder
from app.modules.chatbot.services.prompt_limits import resolve_prompt_limits
from app.providers.base import LlmGeneration, LlmProvider
from app.providers.groq_provider import GroqProvider

logger = logging.getLogger("uvicorn.error")
_LLM_SEMAPHORE = asyncio.Semaphore(max(settings.CHATBOT_MAX_CONCURRENT_LLM, 1))


class RespondCommand:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
        community_guard: CommunityGuard | None = None,
        memory: SessionMemory | None = None,
        persist_history: PersistHistoryCommand | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or GroqProvider()
        self.context_resolver = context_resolver or assistant_context_resolver
        self.scope_guard = scope_guard or assistant_scope_guard
        self.community_guard = community_guard or assistant_community_guard
        self.memory = memory or session_memory
        self.persist_history = persist_history or PersistHistoryCommand()

    async def _run_guard_chain(
        self,
        working_request: AssistantRespondRequest,
        history: list[AssistantHistoryItem],
        last_intent: str | None,
        has_follow_up_anchor: bool,
    ) -> tuple[AssistantRespondData | None, str | None, ScopeDecision | None, list]:
        # --- Mental health crisis check (highest priority guard) ---
        # MENTAL_HEALTH_GUARD_SLOT

        # --- Community Guard ---
        community_decision = self.community_guard.evaluate(working_request.message)
        if not community_decision.allowed:
            data = self._community_response(community_decision.reason)
            return data, "community_guard", None, []

        # --- Context Resolver ---
        candidate_contexts = (
            self._dedupe_contexts(working_request.contexts)
            if working_request.contexts
            else await self._resolve_contexts_with_budget(
                working_request,
                settings.CHATBOT_CONTEXT_RESOLVE_TIMEOUT_MS,
            )
        )
        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        # --- Scope Guard ---
        scope_decision = self.scope_guard.evaluate_scope(
            working_request,
            last_intent=last_intent,
            recent_history=history,
        )

        if scope_decision.reason == "greeting":
            return self._greeting_response(), "greeting", scope_decision, candidate_contexts

        if not scope_decision.in_scope:
            intent = "out_of_scope"
            if "privacy" in scope_decision.matched_domains:
                data = self._privacy_policy_response()
                intent = "privacy"
            elif scope_decision.state == "in_domain_unknown":
                data = self._in_domain_unknown_response(scope_decision.matched_domains)
                intent = "in_domain_unknown"
            elif scope_decision.state == "ambiguous":
                data = self._ambiguous_scope_response(scope_decision.matched_domains)
                intent = "clarify"
            else:
                data = self._out_of_scope_response()
            return data, intent, scope_decision, candidate_contexts

        prompt_limits = resolve_prompt_limits(working_request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        
        if not final_contexts and scope_decision.matched_domains and not has_follow_up_anchor:
            data = self._in_domain_unknown_response(scope_decision.matched_domains)
            return data, "in_domain_unknown", scope_decision, candidate_contexts

        return None, None, scope_decision, candidate_contexts

    async def execute(self, request: AssistantRespondRequest) -> AssistantRespondData:
        started_at = time.perf_counter()
        request_id = str(uuid4())
        session_key = self._session_key(request)
        history = self._resolve_history(request, session_key)
        last_intent = request.intent or self.memory.get_last_intent(session_key)
        memory_facts = self.memory.get_facts(session_key)
        effective_message, has_follow_up_anchor = self._resolve_follow_up_message(
            request.message,
            history,
            memory_facts,
        )
        working_request = (
            request.model_copy(update={"message": effective_message})
            if effective_message != request.message
            else request
        )

        guard_data, guard_intent, scope_decision, candidate_contexts = await self._run_guard_chain(
            working_request, history, last_intent, has_follow_up_anchor
        )
        
        if guard_data:
            self._persist_session_memory(request, guard_data.reply, [], guard_intent)
            persisted = await self.persist_history.execute(
                request=request,
                assistant_reply=guard_data.reply,
                sources=[],
                intent=guard_intent,
            )
            return guard_data.model_copy(
                update={
                    "requestId": request_id,
                    "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                    "persisted": persisted,
                    "conversationId": request.conversationId or "default",
                }
            )

        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        memory_summary = self.memory.get_summary(session_key)
        memory_context = self._build_memory_context(memory_summary, memory_facts)
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        resolved_request = working_request.model_copy(update={"contexts": final_contexts})
        prompt = self.prompt_builder.build(
            resolved_request,
            history,
            memory_context,
            context_char_limit=prompt_limits.context_char_limit,
            max_history_items=prompt_limits.max_history_items,
            history_item_char_limit=prompt_limits.history_item_char_limit,
            context_total_char_limit=prompt_limits.context_total_char_limit,
        )
        prompt = self._prepend_turn_policy(prompt)

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
        resolved_intent = request.intent or self._infer_intent(
            final_contexts,
            fallback_domains=scope_decision.matched_domains,
        )
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
        updated_summary = self._build_updated_summary(
            memory_summary,
            request.message,
            assistant_reply,
        )
        facts = {
            "last_intent": intent or "",
            "last_user_message": self._truncate_text(request.message, 140),
            "last_assistant_reply": self._truncate_text(assistant_reply, 180),
        }
        self.memory.update_session_batch(
            key=session_key,
            user_message=request.message,
            assistant_reply=assistant_reply,
            summary=updated_summary,
            intent=intent,
            sources=sources,
            facts=facts,
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
        return self._truncate_text(combined, settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT)

    def _build_memory_context(self, summary: str, facts: dict[str, str]) -> str:
        if not facts:
            return summary
        fact_lines = [f"{key}: {value}" for key, value in facts.items() if value]
        facts_block = "\n".join(fact_lines[:8])
        payload = {
            "summary": summary,
            "facts": facts_block,
        }
        return self._truncate_text(
            json.dumps(payload, ensure_ascii=False),
            settings.CHATBOT_MEMORY_SUMMARY_CHAR_LIMIT,
        )

    def _infer_intent(
        self,
        contexts,
        fallback_domains: tuple[str, ...] = (),
    ) -> str | None:
        if not contexts:
            return fallback_domains[0] if fallback_domains else None
        first_type = contexts[0].type
        if first_type in {"post", "group", "user", "help_doc"}:
            return first_type
        return fallback_domains[0] if fallback_domains else None

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

    def _prepend_turn_policy(self, prompt: str) -> str:
        policy = (
            "TURN_POLICY:\n"
            "- User did not greet in this turn.\n"
            "- Start directly with the answer content.\n"
            "- Do not open with greeting words (e.g., xin chao/hello/hi).\n"
        )
        return f"{policy}\n{prompt}"

    def _resolve_follow_up_message(
        self,
        message: str,
        history: list[AssistantHistoryItem],
        memory_facts: dict[str, str],
    ) -> tuple[str, bool]:
        normalized = self.scope_guard._normalize(message)
        if not self._is_follow_up_reference(normalized):
            return message, False

        anchor = self._pick_recent_user_anchor(history, memory_facts)
        if not anchor:
            return message, False
        rewritten = f"{message.strip()}\n\nFOLLOW_UP_ANCHOR:\n{anchor}"
        return rewritten, True

    def _pick_recent_user_anchor(
        self,
        history: list[AssistantHistoryItem],
        memory_facts: dict[str, str],
    ) -> str:
        for item in reversed(history[-10:]):
            if item.role != "user":
                continue
            content = " ".join(str(item.content or "").split())
            if not content:
                continue
            if content == memory_facts.get("last_user_message", ""):
                continue
            normalized = self.scope_guard._normalize(content)
            if normalized in {"hi", "hello", "hey", "xin chao", "chao"}:
                continue
            if len(normalized.split()) <= 2:
                continue
            if self._is_follow_up_reference(normalized):
                continue
            return self._truncate_text(content, 220)
        fallback = memory_facts.get("last_user_message", "")
        return self._truncate_text(fallback, 220) if fallback else ""

    def _is_follow_up_reference(self, normalized_message: str) -> bool:
        if not normalized_message:
            return False
        patterns = (
            r"\b(no|cai do|cai nay|truoc do|y truoc do|van de truoc do)\b",
            r"\b(giai thich them|noi ro hon|chi tiet hon|tiep theo)\b",
            r"\b(nhu vay|nhu tren|phan do|muc do)\b",
        )
        return any(re.search(pattern, normalized_message) for pattern in patterns)

    def _in_domain_unknown_response(
        self,
        matched_domains: tuple[str, ...],
    ) -> AssistantRespondData:
        domain_hint = ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
        return AssistantRespondData(
            reply=(
                f"Câu hỏi của bạn vẫn thuộc phạm vi {domain_hint}, "
                "nhưng hiện mình chưa có đủ dữ liệu hoặc tài liệu để trả lời chính xác tính năng này. "
                "Bạn có thể mô tả rõ hơn màn hình hoặc thao tác đang dùng để mình hỗ trợ theo hướng gần nhất."
            ),
            sources=[],
            suggestedActions=[],
            model="scope-guard",
            provider="chatbot-service",
        )

    def _privacy_policy_response(self) -> AssistantRespondData:
        return AssistantRespondData(
            reply=(
                "Mình có thể hỗ trợ câu hỏi về quyền riêng tư trên Sentimeta. "
                "Hiện tại mình chưa có trích dẫn chính sách cụ thể trong context để xác nhận chi tiết điều khoản. "
                "Bạn có thể nêu rõ mục bạn cần (dữ liệu cá nhân, quyền truy cập, chặn người dùng, xoá tài khoản) để mình hướng dẫn theo luồng sử dụng phù hợp."
            ),
            sources=[],
            suggestedActions=[],
            model="scope-guard",
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

    def _ambiguous_scope_response(self, matched_domains: tuple[str, ...]) -> AssistantRespondData:
        domain_hint = ", ".join(matched_domains[:3]) if matched_domains else "hệ thống Sentimeta"
        return AssistantRespondData(
            reply=(
                "Mình chưa chắc bạn đang hỏi phần nào. "
                f"Bạn muốn mình hỗ trợ về {domain_hint} hay phần khác trong Sentimeta? "
                "Bạn có thể nói rõ mục tiêu trong 1 câu."
            ),
            sources=[],
            suggestedActions=[],
            model="scope-guard",
            provider="chatbot-service",
        )

    def _community_response(self, reason: str) -> AssistantRespondData:
        if reason == "community_violation":
            message = (
                "Mình không thể hỗ trợ nội dung vi phạm tiêu chuẩn cộng đồng. "
                "Bạn hãy đổi sang câu hỏi an toàn và phù hợp hơn để mình hỗ trợ tiếp."
            )
        else:
            message = (
                "Mình chưa thể xử lý câu có từ ngữ tục tĩu hoặc xúc phạm. "
                "Bạn có thể diễn đạt lại lịch sự hơn để mình hỗ trợ chính xác."
            )
        return AssistantRespondData(
            reply=message,
            sources=[],
            suggestedActions=[],
            model="community-guard",
            provider="chatbot-service",
        )

    async def execute_stream(self, request: AssistantRespondRequest) -> AsyncIterator[AssistantRespondData]:
        started_at = time.perf_counter()
        request_id = str(uuid4())
        session_key = self._session_key(request)
        history = self._resolve_history(request, session_key)
        last_intent = request.intent or self.memory.get_last_intent(session_key)
        memory_facts = self.memory.get_facts(session_key)
        effective_message, has_follow_up_anchor = self._resolve_follow_up_message(
            request.message,
            history,
            memory_facts,
        )
        working_request = (
            request.model_copy(update={"message": effective_message})
            if effective_message != request.message
            else request
        )

        guard_data, guard_intent, scope_decision, candidate_contexts = await self._run_guard_chain(
            working_request, history, last_intent, has_follow_up_anchor
        )
        
        if guard_data:
            yield self._finalize_stream_data(guard_data, request_id, started_at, request)
            await self._after_generation(request, guard_data.reply, [], guard_intent)
            return

        working_request = working_request.model_copy(update={"contexts": candidate_contexts})

        memory_summary = self.memory.get_summary(session_key)
        memory_context = self._build_memory_context(memory_summary, memory_facts)
        prompt_limits = resolve_prompt_limits(request.userId)
        final_contexts = candidate_contexts[: prompt_limits.max_context_items]
        resolved_request = working_request.model_copy(update={"contexts": final_contexts})
        prompt = self.prompt_builder.build(
            resolved_request,
            history,
            memory_context,
            context_char_limit=prompt_limits.context_char_limit,
            max_history_items=prompt_limits.max_history_items,
            history_item_char_limit=prompt_limits.history_item_char_limit,
            context_total_char_limit=prompt_limits.context_total_char_limit,
        )
        prompt = self._prepend_turn_policy(prompt)

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

        full_reply_parts = []
        try:
            async with _LLM_SEMAPHORE:
                async for chunk in self.provider.stream(prompt, resolved_request):
                    full_reply_parts.append(chunk.content)
                    yield AssistantRespondData(
                        reply=chunk.content,
                        sources=sources if len(full_reply_parts) == 1 else [],
                        suggestedActions=[],
                        model=chunk.model or settings.GROQ_MODEL,
                        provider=chunk.provider or "groq",
                        requestId=request_id,
                        latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                        conversationId=request.conversationId or "default",
                    )
        except Exception:
            logger.exception("Assistant stream generation failed")
            yield AssistantRespondData(
                reply="Hệ thống gặp lỗi khi tạo phản hồi. Bạn thử lại sau nhé.",
                sources=[],
                suggestedActions=[],
                model="error-guard",
                provider="chatbot-service",
                requestId=request_id,
                latencyMs=round((time.perf_counter() - started_at) * 1000, 2),
                conversationId=request.conversationId or "default",
            )
            return

        full_reply = "".join(full_reply_parts)
        resolved_intent = request.intent or self._infer_intent(
            final_contexts,
            fallback_domains=scope_decision.matched_domains,
        )
        await self._after_generation(request, full_reply, sources, resolved_intent)

    def _finalize_stream_data(
        self, 
        data: AssistantRespondData, 
        request_id: str, 
        started_at: float, 
        request: AssistantRespondRequest
    ) -> AssistantRespondData:
        return data.model_copy(
            update={
                "requestId": request_id,
                "latencyMs": round((time.perf_counter() - started_at) * 1000, 2),
                "conversationId": request.conversationId or "default",
            }
        )

    async def _after_generation(
        self, 
        request: AssistantRespondRequest, 
        reply: str, 
        sources: list[AssistantSource], 
        intent: str | None
    ):
        reply_content = self._sanitize_assistant_reply(reply)
        self._persist_session_memory(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=intent,
        )
        await self.persist_history.execute(
            request=request,
            assistant_reply=reply_content,
            sources=sources,
            intent=intent,
        )




class AssistantService:
    """Facade service that delegates assistant response handling to command layer."""

    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
        context_resolver: AssistantContextResolver | None = None,
        scope_guard: AssistantScopeGuard | None = None,
    ):
        self._respond_command = RespondCommand(
            prompt_builder=prompt_builder,
            provider=provider,
            context_resolver=context_resolver,
            scope_guard=scope_guard,
        )

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        return await self._respond_command.execute(request)




assistant_service = AssistantService()
