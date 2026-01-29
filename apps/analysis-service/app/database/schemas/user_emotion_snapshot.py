from odmantic import Model
from datetime import date
from typing import Dict
from app.enums.emotion_enum import EmotionTimeWindowEnum

class UserEmotionSnapshot(Model):
    userId: str
    window: EmotionTimeWindowEnum # 24h, 7d, 30d
    
    emotionDistribution: Dict[str, float]  # {"joy": 3, "sadness": 5}
    dominantEmotion: str
    
    negativeRatio: float
    riskScore: float  # 0 to 1
    
    computedAt: date