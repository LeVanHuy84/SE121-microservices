from odmantic import Model, Field
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from app.enums.analysis_status_enum import AnalysisStatusEnum, RetryScopeEnum


class EmotionAnalysis(Model):
    userId: str
    targetId: str
    targetType: str
    content: str

    imageUrls: List[str] = Field(default_factory=list)

    # 🔁 CHANGE HERE
    text_emotion: Optional[Dict[str, Any]] = None
    image_emotions: List[Dict[str, Any]] = Field(default_factory=list)
    final_emotion: Optional[str] = None
    final_scores: Optional[Dict[str, float]] = None

    status: AnalysisStatusEnum
    retry_scope: Optional[RetryScopeEnum] = None
    retry_count: int = 0
    error_reason: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
