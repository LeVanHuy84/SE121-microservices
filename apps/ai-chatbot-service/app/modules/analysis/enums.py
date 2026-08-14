from enum import Enum


class AnalysisStatusEnum(str, Enum):
    SUCCESS = 'SUCCESS'
    FAILED = 'FAILED'
    PERMANENT_FAILED = 'PERMANENT_FAILED'

class EmotionEnum(str, Enum):
    JOY = 'joy'
    SADNESS = 'sadness'
    ANGER = 'anger'
    FEAR = 'fear'
    DISGUST = 'disgust'
    SURPRISE = 'surprise'
    NEUTRAL = 'neutral'

class IntensityLevelEnum(str, Enum):
    MILD = 'mild'
    MODERATE = 'moderate'
    SEVERE = 'severe'

class DominantModalityEnum(str, Enum):
    TEXT = 'text'
    IMAGE = 'image'
    # VIDEO = 'video'

class EmotionTimeWindowEnum(str, Enum):
    LAST_7_DAYS = '7d'  # e.g., last 7 days
    LAST_30_DAYS = '30d'  # e.g., last 30 days

class RiskHintLevelEnum(str, Enum):
    NONE = 'none'
    WEAK = 'weak'
    MEDIUM = 'medium'
    HIGH = 'high'

class EventTypeEnum(str, Enum):
    ANALYSIS_CREATED = "analysis_created"
    ANALYSIS_UPDATED = "analysis_updated"

class TargetTypeEnum(str, Enum):
    POST = "POST"
    COMMENT = "COMMENT"
    SHARE = "SHARE"

class ResultEventEnum(str, Enum):
    EMOTION_RESULT = 'emotion-result-events'
    MODERATION_REJECTED = 'moderation-rejected-events'

class ViolationCategoryEnum(str, Enum):
    TOXIC = "toxic"
    SELF_HARM = "self_harm"
    VIOLENCE = "violence"
    SEXUAL = "sexual"
    BLOOD = "blood"
    SAFE = "safe"


class SeverityEnum(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"