from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator


AssistantRole = Literal["system", "user", "assistant"]

# Stable response types exposed to the FE (see chatbot-api-contract.md).
AssistantResponseType = Literal[
    "answer",
    "greeting",
    "out_of_scope",
    "clarify",
    "no_answer",
    "community_blocked",
    "crisis",
    "fallback",
    "navigation",
]


class CrisisResource(BaseModel):
    name: str
    phone: str


class CrisisInfo(BaseModel):
    severity: Literal["high", "medium"]
    resources: list[CrisisResource] = Field(default_factory=list)
    # True only when the alert event was sent successfully, i.e. support info is also delivered
    # to the user as a notification. No human team contacts the user (no such process exists yet).
    notificationSent: bool = False


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
    clientMessageId: Optional[str] = None
    history: list[AssistantHistoryItem] = Field(default_factory=list)
    contexts: list[AssistantContextItem] = Field(default_factory=list)
    intent: Optional[str] = None


class AssistantSource(BaseModel):
    type: str
    id: str
    title: Optional[str] = None
    source: Optional[str] = None
    score: Optional[float] = None


class NavigatePayload(BaseModel):
    destinationId: str = Field(pattern=r"^[a-z]+(\.[a-z_]+)*$")
    params: dict[str, str] = Field(default_factory=dict)


class NavigateAction(BaseModel):
    type: Literal["navigate"] = "navigate"
    id: str = Field(default_factory=lambda: str(uuid4()))
    label: str = Field(max_length=40)
    payload: NavigatePayload


AssistantSuggestedAction = Annotated[
    Union[NavigateAction],
    Field(discriminator="type"),
]


class AssistantRespondData(BaseModel):
    type: AssistantResponseType = "answer"
    reply: str
    sources: list[AssistantSource] = Field(default_factory=list)
    suggestedActions: list[AssistantSuggestedAction] = Field(default_factory=list, max_length=3)
    model: str
    provider: str
    requestId: Optional[str] = None
    latencyMs: Optional[float] = None
    persisted: Optional[bool] = None
    conversationId: Optional[str] = None
    crisis: Optional[CrisisInfo] = None

    @model_validator(mode="after")
    def validate_crisis_has_no_actions(self) -> "AssistantRespondData":
        if self.type == "crisis" and self.suggestedActions:
            raise ValueError("Crisis response must not contain suggestedActions")
        return self


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
