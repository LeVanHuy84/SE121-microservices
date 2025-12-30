from odmantic import AIOEngine
from bson import ObjectId
from app.database.models.analysis_schema import EmotionAnalysis
from app.enums.analysis_status_enum import AnalysisStatusEnum
from datetime import datetime


class AnalysisRepository:
    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_analysis(self, data: EmotionAnalysis):
        return await self.engine.save(data)

    async def get_analysis_by_id(self, analysisId: str):
        # convert id string -> ObjectId
        try:
            obj_id = ObjectId(analysisId)
        except:
            return None
        return await self.engine.find_one(EmotionAnalysis, EmotionAnalysis.id == obj_id)

    async def get_analysis_by_target(self, targetId: str, targetType: str):
        return await self.engine.find_one(
            EmotionAnalysis,
            (EmotionAnalysis.targetId == targetId) &
            (EmotionAnalysis.targetType == targetType)
        )
    
    async def find_failed(self, max_retry: int):
        return await self.engine.find(
            EmotionAnalysis,
            (EmotionAnalysis.status == AnalysisStatusEnum.FAILED) &
            (EmotionAnalysis.retryCount < max_retry)
        )

    async def update_analysis(self, analysisId, update_data: dict):
        try:
            obj_id = ObjectId(analysisId) if isinstance(analysisId, str) else analysisId
        except Exception:
            return None

        analysis = await self.engine.find_one(
            EmotionAnalysis,
            EmotionAnalysis.id == obj_id
        )

        if not analysis:
            return None

        for key, value in update_data.items():
            if hasattr(analysis, key):
                setattr(analysis, key, value)

        return await self.engine.save(analysis)

    # NEW: Get limit
    async def get_history(
        self,
        user_id: str,
        start: datetime,
        end: datetime,
        cursor: datetime | None = None,
        limit: int = 20
    ):
        query = (
            (EmotionAnalysis.userId == user_id) &
            (EmotionAnalysis.createdAtVN >= start) &
            (EmotionAnalysis.createdAtVN <= end)
        )

        if cursor:
            query = query & (EmotionAnalysis.createdAtVN < cursor)

        return await self.engine.find(
            EmotionAnalysis,
            query,
            sort=EmotionAnalysis.createdAtVN.desc(),
            limit=limit
        )



    # NEW: filter by date range
    async def get_analysis_by_date_range(self, user_id: str, from_date: datetime, to_date: datetime):
        return await self.engine.find(
            EmotionAnalysis,
            (EmotionAnalysis.userId == user_id) &
            (EmotionAnalysis.createdAtVN >= from_date) &
            (EmotionAnalysis.createdAtVN <= to_date),
        )

    # NEW: get successful entries for summary
    async def get_all_for_summary(self, user_id: str, start: datetime, end: datetime):
        return await self.engine.find(
            EmotionAnalysis,
            (EmotionAnalysis.userId == user_id) &
            (EmotionAnalysis.createdAtVN >= start) &
            (EmotionAnalysis.createdAtVN <= end) &
            (EmotionAnalysis.status == AnalysisStatusEnum.SUCCESS)
        )