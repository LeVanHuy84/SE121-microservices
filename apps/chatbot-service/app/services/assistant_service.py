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
from app.services.prompt_builder import PromptBuilder

logger = logging.getLogger("uvicorn.error")


class AssistantService:
    def __init__(
        self,
        prompt_builder: PromptBuilder | None = None,
        provider: LlmProvider | None = None,
    ):
        self.prompt_builder = prompt_builder or PromptBuilder()
        self.provider = provider or self._resolve_provider()

    async def respond(self, request: AssistantRespondRequest) -> AssistantRespondData:
        history = self._resolve_history(request)
        prompt = self.prompt_builder.build(request, history)
        generation = await self.provider.generate(prompt, request)
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
            for item in request.contexts[: settings.CHATBOT_MAX_CONTEXT_ITEMS]
        ]
        logger.info(
            "Assistant response generated: userId=%s provider=%s model=%s contexts=%s",
            request.userId,
            generation.provider,
            generation.model,
            len(request.contexts),
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


assistant_service = AssistantService()
