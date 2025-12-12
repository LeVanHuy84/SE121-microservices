from enum import Enum

class EventType(str, Enum):
    ANALYSIS_CREATED = "analysis_created"
    ANALYSIS_UPDATED = "analysis_updated"