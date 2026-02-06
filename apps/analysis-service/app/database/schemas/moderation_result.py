from odmantic import EmbeddedModel, Model, Field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union
from app.enums.moderation_enum import SeverityEnum
from app.enums.event_enum import TargetTypeEnum

class TextModerationResult(EmbeddedModel):
    content: str
    is_violation: bool
    violation_score: float
    source: str                # phobert_binary | keyword_hard
    sensitive: bool
    flags: Dict[str, bool] = Field(default_factory=dict)    # self_harm_mention, hate_speech...

class ImageModerationResult(EmbeddedModel):
    url: str

    is_violation: bool
    violation: Optional[str] = None        # violence | sexual_explicit | blood
    severity: str  # SeverityEnum value: 'none' | 'low' | 'medium' | 'high' | 'critical'
    violation_score: Optional[float] = None
    signal_strength: Optional[str] = None
    category: Optional[str] = None
    scores: Optional[Dict[str, float]] = None
    error: Optional[str] = None

class ModerationResult(Model):
    userId: str

    targetId: str
    targetType: str  # TargetTypeEnum value: 'POST' | 'COMMENT' | 'SHARE'

    # === analysis result ===
    text_result: Union[TextModerationResult, None] = None
    image_results: List[ImageModerationResult] = Field(default_factory=list)

    # === final decision (VERY IMPORTANT) ===
    is_violation: bool
    violation_score: float
    max_severity: str  # SeverityEnum value: 'none' | 'low' | 'medium' | 'high' | 'critical'
    # violation_categories: List[str] = Field(default_factory=list)

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
