from odmantic import EmbeddedModel, Model, Field
from datetime import datetime, timezone
from typing import Dict, List, Optional
from app.enums.moderation_enum import SeverityEnum
from app.enums.event_enum import TargetTypeEnum

class TextModerationResult(EmbeddedModel):
    content: str
    is_violation: bool
    violation_score: float
    source: str                # phobert_binary | keyword_hard
    sensitive: bool
    flags: dict = Field(default_factory=dict)    # self_harm_mention, hate_speech... - using dict instead of Dict[str, bool]

class ImageUnsafeDetails(EmbeddedModel):
    category: Optional[str] = None
    scores: dict = Field(default_factory=dict)  # Changed from Dict[str, float]

class ImageModerationResult(EmbeddedModel):
    url: str

    is_violation: bool
    violation: Optional[str]        # violence | sexual_explicit | blood
    severity: str  # SeverityEnum value: 'none' | 'low' | 'medium' | 'high' | 'critical'
    violation_score: Optional[float]
    signal_strength: Optional[str]
    unsafe_details: Optional[dict] = None  # Changed from ImageUnsafeDetails to dict to avoid ODMantic serialization bug

    error: Optional[str]


class ModerationResult(Model):
    userId: str

    targetId: str
    targetType: str  # TargetTypeEnum value: 'POST' | 'COMMENT' | 'SHARE'

    # === analysis result ===
    text_result: Optional[TextModerationResult] = None
    image_results: List[ImageModerationResult] = Field(default_factory=list)

    # === final decision (VERY IMPORTANT) ===
    is_violation: bool
    violation_score: float
    max_severity: str  # SeverityEnum value: 'none' | 'low' | 'medium' | 'high' | 'critical'
    # violation_categories: List[str] = Field(default_factory=list)

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
