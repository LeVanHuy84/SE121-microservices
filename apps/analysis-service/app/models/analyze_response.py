from typing import List, Dict, Any
from pydantic import BaseModel, HttpUrl, Field

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
