from __future__ import annotations

import logging

from app.core.config import settings
from app.memory.session_memory import session_memory
from app.providers.base import LlmProvider
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

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        if not self.scope_guard.is_in_scope(request):
            return self._out_of_scope_response()

        session_key = self._session_key(request)
        history = self._resolve_history(request)
        memory_summary = session_memory.get_summary(session_key)
        contexts = self.context_resolver.resolve(request)
        prompt_limits = resolve_prompt_limits(request.userId)
        resolved_request = request.model_copy(update={"contexts": contexts})
        prompt = self.prompt_builder.build(resolved_request, history, memory_summary)
        generation = await self.provider.generate(prompt, resolved_request)
        sources = [
            AssistantSource(
                type=item.type,
                id=item.id,
                title=item.title,
                source=item.source,
                score=item.score,
            )
            for item in contexts[: prompt_limits.max_context_items]
        ]
        session_memory.append_exchange(
            session_key,
            request.message,
            generation.content,
        )
        session_memory.set_summary(
            session_key,
            self._build_updated_summary(
                memory_summary,
                request.message,
                generation.content,
            ),
        )
        session_memory.set_last_intent(session_key, request.intent or self._infer_intent(contexts))
        session_memory.set_last_sources(session_key, sources)
        logger.info(
            "Assistant response generated: userId=%s provider=%s model=%s contexts=%s promptVariant=%s",
            request.userId,
            generation.provider,
            generation.model,
            len(contexts),
            prompt_limits.variant,
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
        conversation_id = request.conversationId or "default"
        return f"{request.userId}:{conversation_id}"

    def _resolve_provider(self) -> LlmProvider:
        return GroqProvider()

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
