from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


AssistantRole = Literal["system", "user", "assistant"]


class AssistantHistoryItem(BaseModel):
    role: AssistantRole
    content: str


class AssistantContextItem(BaseModel):
    type: str
    id: str
    title: Optional[str] = None
    content: str
    score: Optional[float] = None
    source: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantRespondRequest(BaseModel):
    userId: str
    conversationId: Optional[str] = None
    message: str
    history: list[AssistantHistoryItem] = Field(default_factory=list)
    contexts: list[AssistantContextItem] = Field(default_factory=list)
    intent: Optional[str] = None


class AssistantSource(BaseModel):
    type: str
    id: str
    title: Optional[str] = None
    source: Optional[str] = None
    score: Optional[float] = None


class AssistantSuggestedAction(BaseModel):
    type: str
    label: str
    payload: dict[str, Any] = Field(default_factory=dict)


class AssistantRespondData(BaseModel):
    reply: str
    sources: list[AssistantSource] = Field(default_factory=list)
    suggestedActions: list[AssistantSuggestedAction] = Field(default_factory=list)
    model: str
    provider: str
    requestId: Optional[str] = None
    latencyMs: Optional[float] = None
    persisted: Optional[bool] = None
    conversationId: Optional[str] = None


class AssistantRespondResponse(BaseModel):
    success: bool
    data: AssistantRespondData


class AssistantHistoryMessage(BaseModel):
    id: str
    conversation_id: str
    user_id: str
    role: str
    content: str
    intent: Optional[str] = None
    sources: list[AssistantSource] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class AssistantHistoryPageData(BaseModel):
    items: list[AssistantHistoryMessage] = Field(default_factory=list)
    next_cursor_created_at: Optional[datetime] = None
    next_cursor_id: Optional[str] = None
    has_more: bool = False


class AssistantHistoryPageResponse(BaseModel):
    success: bool
    data: AssistantHistoryPageData


class AssistantHistoryClearData(BaseModel):
    deleted_count: int
    session_cleared: bool


class AssistantHistoryClearResponse(BaseModel):
    success: bool
    data: AssistantHistoryClearData
