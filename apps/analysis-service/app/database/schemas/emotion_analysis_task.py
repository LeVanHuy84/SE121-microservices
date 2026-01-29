
from datetime import datetime, timezone
from typing import Optional
from odmantic import Field, Model
from app.enums.analysis_status_enum import AnalysisStatusEnum, RetryScopeEnum
from app.enums.event_enum import TargetTypeEnum


class EmotionAnalysisTask(Model):
    userId: str
    targetId: str
    targetType: TargetTypeEnum

    status: AnalysisStatusEnum
    retryScope: Optional[RetryScopeEnum] = None
    retryCount: int

    errorReason: Optional[str] = None

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))