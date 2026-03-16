from enum import Enum

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