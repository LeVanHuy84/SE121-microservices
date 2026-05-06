from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union
from app.enums.moderation_enum import SeverityEnum
from app.enums.event_enum import TargetTypeEnum

class TextModerationResult(BaseModel):
    content: str
    isViolation: bool
    violationScore: float
    source: str                # phobert_binary | keyword_hard
    sensitive: bool
    flags: Dict[str, bool] = Field(default_factory=dict)    # self_harm_mention, hate_speech...

class ImageModerationResult(BaseModel):
    url: str

    isViolation: bool
    violation: Optional[str] = None        # violence | sexual_explicit | blood
    severity: SeverityEnum  
    violationScore: Optional[float] = None
    signalStrength: Optional[str] = None
    category: Optional[str] = None
    scores: Optional[Dict[str, float]] = None

class ModerationResult(BaseModel):
    id: Optional[str] = None
    userId: str

    targetId: str
    targetType: TargetTypeEnum

    # === analysis result ===
    textResult: Union[TextModerationResult, None] = None
    imageResults: List[ImageModerationResult] = Field(default_factory=list)

    # === final decision (VERY IMPORTANT) ===
    isViolation: bool
    violationScore: float
    maxSeverity: SeverityEnum  
    
    modelVersion: str

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
