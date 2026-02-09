from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict

class UserEmotionProfile(BaseModel):
    id: Optional[str] = None
    userId: str
    
    #  === Long-term baseline ===
    emotionVectorEMA: Dict[str, float]  # exponential moving avg (14–30d)
    dominantBaselineEmotion: str

    # === Risk tracking ===
    negativeStreakDays: int
    lastNegativeAt: Optional[datetime] = None

    # === Meta ===
    totalAnalyses: int
    updatedAt: datetime