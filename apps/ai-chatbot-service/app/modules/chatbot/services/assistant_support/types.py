from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.modules.chatbot.schemas import (
    AssistantContextItem,
    AssistantHistoryItem,
    AssistantRespondData,
    AssistantRespondRequest,
    AssistantSource,
    NavigateAction,
)
from app.modules.chatbot.services.emotion_context import EmotionSnapshot
from app.modules.chatbot.services.guardrails import ScopeDecision


@dataclass(slots=True)
class PreparedTurn:
    working_request: AssistantRespondRequest
    conv_id: str
    history: list[AssistantHistoryItem]
    user_facts: dict[str, str]
    emotion_snapshot: EmotionSnapshot
    scope_decision: ScopeDecision
    final_contexts: list[AssistantContextItem]
    sources: list[AssistantSource]
    active_tools: list[dict[str, Any]]
    supports_tools: bool
    pending_actions: list[Any]
    howto_actions: list[Any]
    messages_or_prompt: Any
    is_proactive_checkin: bool
    in_chat_distress: bool
    is_system_turn: bool
    guard_data: AssistantRespondData | None = None
    guard_intent: str | None = None


@dataclass(slots=True)
class GuardResult:
    """Outcome of the guard chain: either a final `data` reply, or the context to generate one."""

    data: AssistantRespondData | None = None
    intent: str | None = None
    scope_decision: ScopeDecision | None = None
    contexts: list = field(default_factory=list)
    pending_actions: list[NavigateAction] = field(default_factory=list)
