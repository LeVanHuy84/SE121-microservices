from dataclasses import dataclass
from typing import Protocol

from app.schemas.assistant_schema import AssistantRespondRequest


@dataclass(frozen=True)
class LlmGeneration:
    content: str
    model: str
    provider: str


class LlmProvider(Protocol):
    async def generate(
        self,
        prompt: str,
        request: AssistantRespondRequest,
    ) -> LlmGeneration:
        ...
