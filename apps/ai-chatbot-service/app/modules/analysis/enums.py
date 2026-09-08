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

class EmotionTimeWindowEnum(str, Enum):
    LAST_7_DAYS = '7d'
    LAST_30_DAYS = '30d'

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

class ModerationActionEnum(str, Enum):
    ALLOW = "ALLOW"
    ALLOW_WITH_WARNING = "ALLOW_WITH_WARNING"
    ALLOW_WITH_SUPPORT = "ALLOW_WITH_SUPPORT"
    HARD_BLOCK = "HARD_BLOCK"

class ModerationLabelEnum(str, Enum):
    CLEAN = "CLEAN"
    PROFANITY_VENTING = "PROFANITY_VENTING"
    HATE_SPEECH = "HATE_SPEECH"
    EMOTIONAL_CRISIS = "EMOTIONAL_CRISIS"
    ILLEGAL_PORN = "ILLEGAL_PORN"

class ViolationCategoryEnum(str, Enum):
    TOXIC = "TOXIC"
    SELF_HARM = "SELF_HARM"
    VIOLENCE = "VIOLENCE"
    WEAPON = "WEAPON"
    BLOOD = "BLOOD"
    SEXUAL = "SEXUAL"
    NSFW_ADULT = "NSFW_ADULT"
    HATE_SPEECH = "HATE_SPEECH"
    PROFANITY_VENTING = "PROFANITY_VENTING"
    ILLEGAL_PORN = "ILLEGAL_PORN"
    TEXT = "TEXT"

class SeverityEnum(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"