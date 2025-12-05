from odmantic import Model, EmbeddedModel
from datetime import datetime
from typing import List


class EmotionScores(EmbeddedModel):
    anger: float
    disgust: float
    joy: float
    fear: float
    neutral: float
    sadness: float
    surprise: float


class TextEmotion(EmbeddedModel):
    dominant_emotion: str
    emotion_scores: EmotionScores


class ImageEmotion(EmbeddedModel):
    url: str
    face_count: int
    dominant_emotion: str
    emotion_scores: EmotionScores


class EmotionAnalysis(Model):
    userId: str
    targetId: str
    targetType: str

    text_emotion: TextEmotion
    image_emotions: List[ImageEmotion]

    final_emotion: str
    final_scores: EmotionScores

    created_at: datetime = datetime.utcnow()
    updated_at: datetime = datetime.utcnow()
