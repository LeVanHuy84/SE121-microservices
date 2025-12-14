from odmantic import Model, Field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import List, Optional, Dict, Any
from app.enums.analysis_status_enum import AnalysisStatusEnum, RetryScopeEnum

VN_TZ = ZoneInfo("Asia/Ho_Chi_Minh")

class EmotionAnalysis(Model):
    userId: str
    targetId: str
    targetType: str
    content: str

    imageUrls: List[str] = Field(default_factory=list)

    # 🔁 CHANGE HERE
    textEmotion: Optional[Dict[str, Any]] = None
    imageEmotions: List[Dict[str, Any]] = Field(default_factory=list)
    finalEmotion: Optional[str] = None
    finalScores: Optional[Dict[str, float]] = None

    status: AnalysisStatusEnum
    retryScope: Optional[RetryScopeEnum] = None
    retryCount: int = 0
    errorReason: Optional[str] = None

    createdAtVN: datetime = Field(
        default_factory=lambda: datetime.now(VN_TZ).replace(tzinfo=None)
    )

    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))