from odmantic import Model
from datetime import datetime
from typing import List, Optional, Dict

class UserEmotionProfile(Model):
    userId: str
    
    # === Current state ===
    currentMoodScore: float  # -1 (very negative) to +1 (very positive)
    dominantEmotion24h: str
    
    # === Pattern tracking ===
    emotionDistribution7d: Dict[str, float]  # {"joy": 0.3, "sadness": 0.4...}
    emotionDistribution30d: Dict[str, float]
    
    # === Risk indicators ===
    negativeStreak: int  # Consecutive negative posts
    lastNegativeDate: Optional[datetime]
    riskScore: float  # 0-100
    riskLevel: str  # "low|medium|high|critical"
    
    # === Alert history ===
    lastAlertSent: Optional[datetime]
    alertCount30d: int
    
    # === Preferences (for feed) ===
    preferredEmotions: List[str]  # User likes seeing these
    avoidEmotions: List[str]  # User dislikes/triggers
    
    # === Stats ===
    totalAnalyses: int
    avgEngagement: float
    
    updatedAt: datetime