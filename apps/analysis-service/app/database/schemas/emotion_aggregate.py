from odmantic import EmbeddedModel, Model, Field
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from app.enums.emotion_enum import RiskHintLevelEnum


class TextEmotionResult(EmbeddedModel):
    content: str
    dominantEmotion: str
    scores: Dict[str, float]
    confidence: float
    model: str
    meta: Optional[Dict[str, Any]]

class ImageEmotionResult(EmbeddedModel):
    url: str
    dominantEmotion: str
    scores: Dict[str, float]
    confidence: float
    model: str

class EmotionAggregate(Model):
    userId: str
    targetId: str
    targetType: str

    finalEmotion: str
    finalScores: Dict[str, float]
    finalConfidence: float
    dominantModality: str  # 'text' | 'image'

    textResult: TextEmotionResult
    imageResults: List[ImageEmotionResult] = Field(default_factory=list)
    riskHintLevel: RiskHintLevelEnum = RiskHintLevelEnum.NONE



    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
