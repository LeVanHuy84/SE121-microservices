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

        history = self._resolve_history(request)
        contexts = self.context_resolver.resolve(request)
        resolved_request = request.model_copy(update={"contexts": contexts})
        prompt = self.prompt_builder.build(resolved_request, history)
        generation = await self.provider.generate(prompt, resolved_request)
        session_memory.append_exchange(
            self._session_key(request),
            request.message,
            generation.content,
        )
        sources = [
            AssistantSource(
                type=item.type,
                id=item.id,
                title=item.title,
                source=item.source,
                score=item.score,
            )
            for item in contexts[: settings.CHATBOT_MAX_CONTEXT_ITEMS]
        ]
        logger.info(
            "Assistant response generated: userId=%s provider=%s model=%s contexts=%s",
            request.userId,
            generation.provider,
            generation.model,
            len(contexts),
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
            return request.history[-settings.CHATBOT_MAX_HISTORY_ITEMS :]
        return session_memory.get_recent(
            self._session_key(request),
            settings.CHATBOT_MAX_HISTORY_ITEMS,
        )

    def _session_key(self, request: AssistantRespondRequest) -> str:
        conversation_id = request.conversationId or "default"
        return f"{request.userId}:{conversation_id}"

    def _resolve_provider(self) -> LlmProvider:
        return GroqProvider()

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
