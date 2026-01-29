from odmantic import Model, Field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from app.enums.emotion_enum import RiskHintLevelEnum

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

class EmotionResult(BaseModel):
    modality: str  # text | image | video
    dominantEmotion: str
    scores: Dict[str, float]
    confidence: float
    model: str
    meta: Optional[Dict[str, Any]] = None

class EmotionAggregate(Model):
    userId: str
    targetId: str
    targetType: str

    finalEmotion: str
    finalScores: Dict[str, float]
    finalConfidence: float
    dominantModality: str  # 'text' | 'image'

    results: List[EmotionResult] = Field(default_factory=list)
    riskHintLevel: RiskHintLevelEnum = RiskHintLevelEnum.NONE


    createdAtVN: datetime = Field(
        default_factory=lambda: datetime.now(VN_TZ).replace(tzinfo=None)
    )

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
