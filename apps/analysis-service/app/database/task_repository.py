from odmantic import AIOEngine
from bson import ObjectId
from typing import Optional, List

from app.database.schemas.analysis_task import AnalysisTask
from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.enums.event_enum import TargetTypeEnum


class TaskRepository:
    """Repository for AnalysisTask persistence (only failed tasks)."""

    def __init__(self, engine: AIOEngine):
        self.engine = engine

    async def save_task(self, data: AnalysisTask) -> AnalysisTask:
        return await self.engine.save(data)

    async def get_by_id(self, task_id: str) -> Optional[AnalysisTask]:
        try:
            obj_id = ObjectId(task_id)
        except Exception:
            return None

        return await self.engine.find_one(
            AnalysisTask,
            AnalysisTask.id == obj_id
        )

    async def get_by_target(
        self,
        target_id: str,
        target_type: TargetTypeEnum
    ) -> Optional[AnalysisTask]:

        return await self.engine.find_one(
            AnalysisTask,
            (AnalysisTask.targetId == target_id) &
            (AnalysisTask.targetType == target_type)
        )

    async def update_task(
        self,
        task_id: str,
        update_data: dict
    ) -> Optional[AnalysisTask]:

        try:
            obj_id = ObjectId(task_id) if isinstance(task_id, str) else task_id
        except Exception:
            return None

        task = await self.engine.find_one(
            AnalysisTask,
            AnalysisTask.id == obj_id
        )

        if not task:
            return None

        for key, value in update_data.items():
            if hasattr(task, key):
                setattr(task, key, value)

        return await self.engine.save(task)

    async def find_failed_tasks(self, max_retry: int) -> List[AnalysisTask]:

        return await self.engine.find(
            AnalysisTask,
            (AnalysisTask.status == AnalysisStatusEnum.FAILED) &
            (AnalysisTask.retryCount < max_retry)
        )
