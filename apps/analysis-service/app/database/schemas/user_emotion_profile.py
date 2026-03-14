from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict

class UserEmotionProfile(BaseModel):
    id: Optional[str] = None
    userId: str

    emotionVectorEMA: Dict[str, float]

    negativeStreak: int
    lastNegativeAt: Optional[datetime] = None

    domainBaselineEmotion: Dict[str, float]

    lastUpdated: datetime