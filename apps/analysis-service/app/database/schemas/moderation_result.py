from odmantic import EmbeddedModel, Model, Field
from datetime import datetime
from typing import Dict, List, Optional
from app.enums.moderation_enum import SeverityEnum
from app.enums.event_enum import TargetTypeEnum

class TextModerationResult(EmbeddedModel):
    is_violation: bool
    confidence: float
    source: str                # phobert_binary | keyword_hard
    sensitive: bool

    flags: Dict[str, bool] = {}   # self_harm_mention, hate_speech...
    reason: Optional[str] = None  # toxic, harassment...

class ImageUnsafeDetails(EmbeddedModel):
    is_unsafe: bool
    category: Optional[str]
    confidence: float
    signal_strength: str
    model: str
    scores: Dict[str, float]
    error: Optional[str] = None

class ImageModerationResult(EmbeddedModel):
    url: str

    is_violation: bool
    violation: Optional[str]        # violence | sexual_explicit | blood
    severity: SeverityEnum

    safe: bool
    unsafe_details: Optional[ImageUnsafeDetails]

    error: Optional[str] = None
    retryable: bool = False



class ModerationResult(Model):
    userId: str

    targetId: str
    targetType: TargetTypeEnum

    content: Optional[str] = None
    imageUrls: List[str] = []

    # === analysis result ===
    text_result: Optional[TextModerationResult] = None
    image_results: List[ImageModerationResult] = []

    # === final decision (VERY IMPORTANT) ===
    is_violation: bool
    max_severity: SeverityEnum
    violation_categories: List[str] = []

    confidence: float          # aggregated confidence
    decided_by: str            # rule_engine | admin | auto

    createdAt: datetime = Field(default_factory=datetime.utcnow)
