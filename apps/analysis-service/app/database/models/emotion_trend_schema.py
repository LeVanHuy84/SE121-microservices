from odmantic import Model
from datetime import date
from typing import Dict

class EmotionTrendSnapshot(Model):
    userId: str
    date: date  # Daily snapshot
    
    emotionCounts: Dict[str, int]  # {"joy": 3, "sadness": 5}
    avgIntensity: float
    dominantEmotion: str
    negativeRatio: float  # % negative content
    
    # For visualization
    moodScore: float  # -1 to +1