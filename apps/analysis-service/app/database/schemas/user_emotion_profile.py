from pydantic import BaseModel, Field
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
    
    # === Idempotency & Concurrency ===
    lastProcessedAggregateId: Optional[str] = None  # Prevents duplicate processing
    version: int = Field(default=1)  # Optimistic locking for concurrent updates