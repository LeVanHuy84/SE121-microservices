from pydantic import BaseModel
from datetime import date
from typing import Dict, Optional
from app.enums.emotion_enum import EmotionTimeWindowEnum

class UserEmotionSnapshot(BaseModel):
    id: Optional[str] = None
    userId: str
    window: EmotionTimeWindowEnum # 24h, 7d, 30d
    
    emotionDistribution: Dict[str, float]  # {"joy": 3, "sadness": 5}
    dominantEmotion: str
    
    negativeRatio: float
    riskScore: float  # 0 to 1
    
    computedAt: date