
from datetime import datetime, timezone
from typing import Optional
from odmantic import Field, Model
from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.enums.event_enum import EventTypeEnum
from app.enums.event_enum import TargetTypeEnum


class AnalysisTask(Model):
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    action: EventTypeEnum

    content: str
    imageUrls: list[str] = Field(default_factory=list)

    status: AnalysisStatusEnum
    retryCount: int

    error: Optional[str] = None

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))