from dataclasses import dataclass
from typing import Protocol, AsyncIterator, Optional

from app.modules.chatbot.schemas import AssistantRespondRequest

@dataclass(frozen=True)
class LlmGeneration:
    content: str
    model: str
    provider: str

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
    ) -> LlmGeneration:
        ...

    def stream(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> AsyncIterator[LlmChunk]:
        ...
