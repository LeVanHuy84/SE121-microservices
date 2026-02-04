from enum import Enum

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
