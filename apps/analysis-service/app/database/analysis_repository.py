from odmantic import AIOEngine
from bson import ObjectId
from app.database.models.analysis_schema import EmotionAnalysis


class AnalysisRepository:
    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_analysis(self, data: EmotionAnalysis):
        return await self.engine.save(data)

    async def get_analysis_by_id(self, analysis_id: str):
        # convert id string -> ObjectId
        try:
            obj_id = ObjectId(analysis_id)
        except:
            return None
        return await self.engine.find_one(EmotionAnalysis, EmotionAnalysis.id == obj_id)

    async def get_analysis_by_target(self, target_id: str, target_type: str):
        return await self.engine.find_one(
            EmotionAnalysis,
            (EmotionAnalysis.targetId == target_id) &
            (EmotionAnalysis.targetType == target_type)
        )

    async def update_analysis(self, analysis_id: str, update_data: dict):
        analysis = await self.get_analysis_by_id(analysis_id)
        if not analysis:
            return None

        for key, value in update_data.items():
            setattr(analysis, key, value)

        return await self.engine.save(analysis)
