from pydantic import BaseModel
from datetime import datetime
from typing import Dict, Optional
from app.enums.emotion_enum import EmotionTimeWindowEnum

class UserEmotionSnapshot(BaseModel):
    id: Optional[str] = None
    userId: str
    window: EmotionTimeWindowEnum # 7d, 30d
    
    emotionDistribution: Dict[str, float]
    negativeRatio: float
    # Required for emotional stability analytics; do not remove in refactors.
    emotionVolatility: float
    riskScore: float
    createdAt: datetime