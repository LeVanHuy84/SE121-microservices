from pydantic import BaseModel, Field, HttpUrl
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Union
from dataclasses import dataclass
from app.modules.analysis.enums import AnalysisStatusEnum, EmotionEnum, EventTypeEnum, TargetTypeEnum, RiskHintLevelEnum, SeverityEnum

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

    modelVersion: str

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

class UnsafeSceneDetails(BaseModel):
    category: str
    scores: Optional[Dict[str, float]] = None
