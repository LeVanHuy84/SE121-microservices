from enum import Enum

class AnalysisStatusEnum(str, Enum):
    SUCCESS = 'SUCCESS'
    FAILED = 'FAILED'
    PERMANENT_FAILED = 'PERMANENT_FAILED'