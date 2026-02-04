from odmantic import AIOEngine
from bson import ObjectId
from app.database.schemas.emotion_aggregate import EmotionAggregate
from datetime import datetime


class AnalysisRepository:
    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_analysis(self, data: EmotionAggregate):
        return await self.engine.save(data)

    async def get_analysis_by_id(self, analysisId: str):
        # convert id string -> ObjectId
        try:
            obj_id = ObjectId(analysisId)
        except:
            return None
        return await self.engine.find_one(EmotionAggregate, EmotionAggregate.id == obj_id)

    async def get_analysis_by_target(self, targetId: str, targetType: str):
        return await self.engine.find_one(
            EmotionAggregate,
            (EmotionAggregate.targetId == targetId) &
            (EmotionAggregate.targetType == targetType)
        )
    

    async def update_analysis(self, analysisId, update_data: dict):
        try:
            obj_id = ObjectId(analysisId) if isinstance(analysisId, str) else analysisId
        except Exception:
            return None

        analysis = await self.engine.find_one(
            EmotionAggregate,
            EmotionAggregate.id == obj_id
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
            (EmotionAggregate.userId == user_id) &
            (EmotionAggregate.createdAtVN >= start) &
            (EmotionAggregate.createdAtVN <= end)
        )

        if cursor:
            query = query & (EmotionAggregate.createdAtVN < cursor)

        return await self.engine.find(
            EmotionAggregate,
            query,
            sort=EmotionAggregate.createdAtVN.desc(),
            limit=limit
        )



    # NEW: filter by date range
    async def get_analysis_by_date_range(self, user_id: str, from_date: datetime, to_date: datetime):
        return await self.engine.find(
            EmotionAggregate,
            (EmotionAggregate.userId == user_id) &
            (EmotionAggregate.createdAtVN >= from_date) &
            (EmotionAggregate.createdAtVN <= to_date),
        )

    # NEW: get successful entries for summary
    async def get_all_for_summary(self, user_id: str, start: datetime, end: datetime):
        return await self.engine.find(
            EmotionAggregate,
            (EmotionAggregate.userId == user_id) &
            (EmotionAggregate.createdAtVN >= start) &
            (EmotionAggregate.createdAtVN <= end)
        )    
    
    async def get_user_recent_analyses(self, user_id: str, limit: int = 30):
        return await self.engine.find(
            EmotionAggregate,
            (EmotionAggregate.userId == user_id),
            sort=EmotionAggregate.createdAt.desc(),
            limit=limit
        )

