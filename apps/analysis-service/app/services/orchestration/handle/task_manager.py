import logging
from datetime import datetime, timezone

from app.database.task_repository import TaskRepository
from app.database.schemas.analysis_task import AnalysisTask
from app.enums.analysis_status_enum import AnalysisStatusEnum
from app.enums.event_enum import TargetTypeEnum, EventTypeEnum

logger = logging.getLogger(__name__)


class TaskManager:

    def __init__(self, task_repo: TaskRepository):
        self.task_repo = task_repo

    # ======================================================
    # UPSERT FAILED TASK
    # ======================================================
    async def upsert_failed_task(
        self,
        user_id: str,
        target_id: str,
        target_type: TargetTypeEnum,
        action: EventTypeEnum,
        reason: str,
        content: str,
        image_urls: list[str],
    ) -> dict:

        existing = await self.task_repo.get_by_target(
            target_id,
            target_type
        )

        now = datetime.now(timezone.utc)

        if existing:
            logger.info("Update existing failed task")

            return await self.task_repo.update_task(
                existing["_id"],
                {
                    "status": AnalysisStatusEnum.FAILED.value,
                    "action": action.value,
                    "retryCount": existing.get("retryCount", 0) + 1,
                    "error": reason,
                    "updatedAt": now
                }
            )

        logger.info("Create new failed task")

        # Build Pydantic DTO
        task = AnalysisTask(
            userId=user_id,
            targetId=target_id,
            targetType=target_type,
            action=action,
            status=AnalysisStatusEnum.FAILED,
            retryCount=0,
            error=reason,
            content=content,
            imageUrls=image_urls,
        )

        # Convert to dict for persistence
        data = task.model_dump(mode='json', exclude_none=False, exclude={'id'})
        
        # Convert enums to strings
        if hasattr(data.get('targetType'), 'value'):
            data['targetType'] = data['targetType'].value
        if hasattr(data.get('action'), 'value'):
            data['action'] = data['action'].value
        if hasattr(data.get('status'), 'value'):
            data['status'] = data['status'].value

        return await self.task_repo.save_task(data)

    # ======================================================
    # PERMANENT FAILED
    # ======================================================
    async def mark_permanent_failed(
        self,
        target_id: str,
        target_type: TargetTypeEnum,
        reason: str
    ):

        task = await self.task_repo.get_by_target(
            target_id,
            target_type
        )

        if not task:
            return

        await self.task_repo.update_task(
            task["_id"],
            {
                "status": AnalysisStatusEnum.PERMANENT_FAILED.value,
                "error": reason,
                "updatedAt": datetime.now(timezone.utc)
            }
        )
