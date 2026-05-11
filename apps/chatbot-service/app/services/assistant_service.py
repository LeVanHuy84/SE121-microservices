from __future__ import annotations

from app.commands.assistant.respond_command import RespondCommand
from app.providers.base import LlmProvider
from app.schemas.assistant_schema import AssistantRespondData, AssistantRespondRequest
from app.services.context_resolver import AssistantContextResolver
from app.services.prompt_builder import PromptBuilder
from app.services.scope_guard import AssistantScopeGuard


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

