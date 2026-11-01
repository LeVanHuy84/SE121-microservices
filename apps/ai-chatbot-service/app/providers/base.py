from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Optional, Protocol

from app.modules.chatbot.schemas import AssistantRespondRequest


@dataclass(frozen=True)
class ToolCallInfo:
    id: str
    name: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class LlmGeneration:
    content: str
    model: str
    provider: str
    tool_calls: tuple[ToolCallInfo, ...] = ()


@dataclass(frozen=True)
class LlmChunk:
    content: str
    model: Optional[str] = None
    provider: Optional[str] = None


class LlmProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
        tools: Optional[list[dict[str, Any]]] = None,
    ) -> LlmGeneration:
        ...

    def stream(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> AsyncIterator[LlmChunk]:
        ...
