from odmantic import Model
from datetime import datetime
from typing import Optional, Dict

class UserEmotionProfile(Model):
    userId: str
    
    #  === Long-term baseline ===
    emotionVectorEMA: Dict[str, float]  # exponential moving avg (14–30d)
    dominantBaselineEmotion: str

    # === Risk tracking ===
    negativeStreakDays: int
    lastNegativeAt: Optional[datetime]

    # === Meta ===
    totalAnalyses: int
    updatedAt: datetime