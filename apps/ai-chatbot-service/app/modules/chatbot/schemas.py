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


class SurfaceContext(BaseModel):
    screen: str = Field(pattern=r"^[a-z]+(\.[a-z_]+)*$")
    entityId: Optional[str] = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AssistantRespondRequest(BaseModel):
    userId: str
    conversationId: Optional[str] = None
    message: str
    clientMessageId: Optional[str] = None
    history: list[AssistantHistoryItem] = Field(default_factory=list)
    contexts: list[AssistantContextItem] = Field(default_factory=list)
    intent: Optional[str] = None
    surface: Optional[SurfaceContext] = None
    authToken: Optional[str] = None
    aiPolicy: Optional[str] = "FULL"


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


class CardPayload(BaseModel):
    cardType: Literal["profile", "group", "post", "music", "emotion"]
    title: str
    subtitle: Optional[str] = None
    imageUrl: Optional[str] = None
    actionUrl: Optional[str] = None
    actionLabel: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ShowCardAction(BaseModel):
    type: Literal["show_card"] = "show_card"
    id: str = Field(default_factory=lambda: str(uuid4()))
    label: str = Field(default="Xem chi tiết", max_length=40)
    payload: CardPayload


class ProposeActionPayload(BaseModel):
    actionName: str
    title: str
    description: str
    params: dict[str, Any] = Field(default_factory=dict)
    idempotencyKey: str = Field(default_factory=lambda: str(uuid4()))
    confirmLabel: Optional[str] = "Xác nhận"
    cancelLabel: Optional[str] = "Hủy"
    category: Optional[str] = "social"
    isDestructive: Optional[bool] = False
    expiresAt: Optional[str] = None


class ProposeAction(BaseModel):
    type: Literal["propose_action"] = "propose_action"
    id: str = Field(default_factory=lambda: str(uuid4()))
    label: str = Field(default="Xác nhận thao tác", max_length=40)
    payload: ProposeActionPayload


AssistantSuggestedAction = Annotated[
    Union[NavigateAction, ShowCardAction, ProposeAction],
    Field(discriminator="type"),
]


class AssistantRespondData(BaseModel):
    type: AssistantResponseType = "answer"
    reply: str
    sources: list[AssistantSource] = Field(default_factory=list)
    suggestedActions: list[AssistantSuggestedAction] = Field(default_factory=list, max_length=3)
    cards: list[ShowCardAction] = Field(default_factory=list, max_length=3)
    proposals: list[ProposeAction] = Field(default_factory=list, max_length=3)
    model: str
    provider: str
    requestId: Optional[str] = None
    latencyMs: Optional[float] = None
    persisted: Optional[bool] = None
    conversationId: Optional[str] = None
    crisis: Optional[CrisisInfo] = None
    policyBlocked: Optional[bool] = None

    @model_validator(mode="after")
    def validate_crisis_has_no_actions(self) -> "AssistantRespondData":
        if self.type == "crisis" and (self.suggestedActions or self.cards or self.proposals):
            raise ValueError("Crisis response must not contain suggestedActions, cards, or proposals")
        return self


class ActionExecutionRequest(BaseModel):
    actionId: str
    actionName: str
    params: dict[str, Any] = Field(default_factory=dict)
    idempotencyKey: str
    authToken: Optional[str] = None
    userId: Optional[str] = None
    aiPolicy: Optional[str] = "FULL"


class ActionExecutionResponse(BaseModel):
    success: bool
    actionName: str
    message: str
    data: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class AssistantConversation(BaseModel):
    id: str
    user_id: str
    title: Optional[str] = None
    status: Optional[str] = "active"
    turn_count: Optional[int] = 0
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime] = None
    message_count: Optional[int] = None


class AssistantConversationListData(BaseModel):
    items: list[AssistantConversation]
    total: int
    max_limit: int = 20


class AssistantConversationListResponse(BaseModel):
    success: bool = True
    data: AssistantConversationListData


class AssistantConversationResponse(BaseModel):
    success: bool = True
    data: AssistantConversation


class AssistantCreateConversationRequest(BaseModel):
    title: Optional[str] = None


class AssistantDeleteConversationResponse(BaseModel):
    success: bool = True
    data: dict[str, Any] = Field(default_factory=dict)


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
