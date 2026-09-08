from pydantic import BaseModel, Field, HttpUrl
from datetime import datetime, timezone
from typing import List, Optional, Dict
from dataclasses import dataclass
from app.modules.analysis.enums import (
    AnalysisStatusEnum,
    EmotionEnum,
    EventTypeEnum,
    TargetTypeEnum,
    RiskHintLevelEnum,
    ModerationActionEnum,
    ModerationLabelEnum,
)

class CreateAnalyzeRequest(BaseModel):
    userId: str
    targetId: str
    targetType: str
    content: str
    imageUrls: Optional[List[HttpUrl]] = None

class UpdateAnalyzeRequest(BaseModel):
    targetId: str
    targetType: str
    content: Optional[str] = None

class EmotionQuery(BaseModel):
    userId: str
    targetId: str
    targetType: str
    from_date: Optional[str] = None
    to_date: Optional[str] = None

class EmotionScores(BaseModel):
    anger: float
    disgust: float
    joy: float
    fear: float
    neutral: float
    sadness: float
    surprise: float

class TextEmotion(BaseModel):
    dominant_emotion: str
    emotion_scores: EmotionScores

class ImageEmotion(BaseModel):
    url: HttpUrl
    face_count: int
    dominant_emotion: str
    emotion_scores: EmotionScores

class AnalysisResponse(BaseModel):
    userId: str
    targetId: str
    targetType: str
    text_emotion: TextEmotion
    image_emotions: List[ImageEmotion]
    final_emotion: str
    final_scores: EmotionScores

class HistoryItem(BaseModel):
    id: str
    content: str
    finalEmotion: str
    targetType: str
    createdAt: datetime
    status: str
# app/core/dto/image_input.py

@dataclass
class ImageInput:
    url: str
    bytes: bytes

class AnalysisTask(BaseModel):
    id: Optional[str] = None
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    action: EventTypeEnum

    content: str
    imageUrls: list[str] = Field(default_factory=list)

    status: AnalysisStatusEnum
    retryCount: int

    error: Optional[str] = None

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class IntensityDetail(BaseModel):
    level: str = "moderate"  # mild | moderate | severe
    score: float = 0.5

class EmotionAggregate(BaseModel):
    id: Optional[str] = None
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    modelVersion: str
    pipelineSource: str = "TEXT_PHOBERT"  # 'TEXT_PHOBERT' | 'MULTIMODAL_VLM'

    primaryEmotion: EmotionEnum
    secondaryEmotions: List[EmotionEnum] = Field(default_factory=list)
    finalScores: Dict[str, float]
    finalConfidence: float
    intensity: IntensityDetail = Field(default_factory=IntensityDetail)

    # Multimodal VLM specific features
    isSarcasmOrConflict: bool = False
    conflictExplanation: Optional[str] = ""
    mentalHealthRiskLevel: Optional[str] = "none"
    suggestedAction: Optional[str] = "NO_ACTION"

    content: Optional[str] = ""
    imageUrls: List[str] = Field(default_factory=list)

    riskHintLevel: RiskHintLevelEnum = RiskHintLevelEnum.NONE

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ModerationResult(BaseModel):
    id: Optional[str] = None
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    isViolation: bool
    action: ModerationActionEnum = ModerationActionEnum.ALLOW
    label: ModerationLabelEnum = ModerationLabelEnum.CLEAN
    labelCode: int = 0  # 0 | 1 | 2 | 3 | 4
    confidence: float = 1.0
    mentalHealthSupport: bool = False
    reason: Optional[str] = ""
    flaggedCategories: List[str] = Field(default_factory=list)
    allScores: Dict[str, float] = Field(default_factory=dict)

    pipelineSource: str = "TEXT_PHOBERT"  # 'PHOBERT_TEXT_ONLY' | 'VLM_UNIFIED'
    modelVersion: str = "1.1.0"

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))



class Outbox(BaseModel):
    id: Optional[str] = None
    topic: str
    eventType: str
    payload: dict
    processed: bool = False
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ImagesRequest(BaseModel):
    images: List[HttpUrl]

class TextModerationRequest(BaseModel):
    text: str = Field(..., min_length=1)

class TextModerationResponse(BaseModel):
    is_violation: bool
    confidence: float
    source: str

class ImageModerationRequest(BaseModel):
    urls: List[str] = Field(..., min_items=1)

class ImageModerationResponse(BaseModel):
    url: str
    is_violation: bool
    confidence: float
    source: str

class UnsafeSceneDetails(BaseModel):
    category: str
    scores: Optional[Dict[str, float]] = None
