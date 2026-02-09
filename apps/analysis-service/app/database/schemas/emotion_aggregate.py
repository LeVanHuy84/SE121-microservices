from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from app.enums.emotion_enum import RiskHintLevelEnum, EmotionEnum
from app.enums.event_enum import TargetTypeEnum


class TextEmotionResult(BaseModel):
    content: str
    dominantEmotion: EmotionEnum
    scores: Dict[str, float]
    confidence: float
    model: str
    meta: Optional[Dict[str, Any]] = None

class ImageEmotionResult(BaseModel):
    url: str
    dominantEmotion: EmotionEnum
    scores: Dict[str, float]
    confidence: float
    model: str
    sceneType: Optional[str] = None
    sceneContext: Optional[str] = None

class EmotionAggregate(BaseModel):
    id: Optional[str] = None
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    finalEmotion: EmotionEnum
    finalScores: Dict[str, float]
    finalConfidence: float
    dominantModality: str  # 'text' | 'image'
    dominantSceneType: Optional[str] = None
    intensity: dict

    textResult: Optional[TextEmotionResult] = None
    imageResults: List[ImageEmotionResult] = Field(default_factory=list)

    riskHintLevel: RiskHintLevelEnum = RiskHintLevelEnum.NONE

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
