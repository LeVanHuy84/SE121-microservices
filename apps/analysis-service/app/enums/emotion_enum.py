from enum import Enum

class EmotionEnum(str, Enum):
    JOY = 'joy'
    SADNESS = 'sadness'
    ANGER = 'anger'
    FEAR = 'fear'
    DISGUST = 'disgust'
    SURPRISE = 'surprise'
    NEUTRAL = 'neutral'

class EmotionTimeWindowEnum(str, Enum):
    LAST_24_HOURS = '24h'  # e.g., last 24 hours
    LAST_7_DAYS = '7d'  # e.g., last 7 days
    LAST_30_DAYS = '30d'  # e.g., last 30 days

class RiskHintLevelEnum(str, Enum):
    NONE = 'none'
    WEAK = 'weak'
    MEDIUM = 'medium'
    HIGH = 'high'