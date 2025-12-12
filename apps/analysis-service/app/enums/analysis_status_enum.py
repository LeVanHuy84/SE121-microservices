from enum import Enum

class AnalysisStatusEnum(str, Enum):
    SUCCESS = 'SUCCESS'
    FAILED = 'FAILED'
    PERMANENT_FAILED = 'PERMANENT_FAILED'

class RetryScopeEnum(str, Enum):
    FULL = "FULL"
    TEXT_ONLY = "TEXT_ONLY"