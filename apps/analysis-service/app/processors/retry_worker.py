import asyncio
import logging

from app.utils.exceptions import RetryableException
from app.enums.event_enum import EventTypeEnum

from app.services.orchestration.analysis_flow_service import analysis_flow_service
from app.services.orchestration.handle.moderation_writer import ModerationWriter
from app.services.orchestration.handle.emotion_writer import EmotionWriter
from app.services.orchestration.handle.task_manager import TaskManager
from app.services.orchestration.handle.outbox_emitter import OutboxEmitter

logger = logging.getLogger(__name__)


class RetryWorker:

    MAX_RETRY = 2
    SLEEP_SECONDS = 3600

    def __init__(
        self,
        emotion_aggregate_repo,
        moderation_repo,
        task_repo,
        outbox_repo
    ):
        self.task_repository = task_repo
        self.moderation_repo = moderation_repo

        self.moderation_writer = ModerationWriter(moderation_repo)
        self.emotion_writer = EmotionWriter(emotion_aggregate_repo)
        self.task_manager = TaskManager(task_repo)
        self.outbox = OutboxEmitter(outbox_repo)

        self._running = True

    # ======================================================
    # LOOP
    # ======================================================
    def stop(self):
        self._running = False

    async def start(self):
        while self._running:
            try:
                await self.process_failed()
            except Exception:
                logger.exception("[RetryWorker] LOOP ERROR")

            await asyncio.sleep(self.SLEEP_SECONDS)

    # ======================================================
    # PROCESS FAILED
    # ======================================================
    async def process_failed(self):
        tasks = await self.task_repository.find_failed_tasks(
            max_retry=self.MAX_RETRY
        )

        for task in tasks:
            try:
                await self.retry_task(task)
            except RetryableException:
                continue
            except Exception:
                continue

    # ======================================================
    # RETRY SINGLE TASK
    # ======================================================
    async def retry_task(self, task: dict):

        try:
            result = await analysis_flow_service.analyze_content(
                text=task.get("content", ""),
                image_urls=task.get("imageUrls", []),
                target_type=task["targetType"]
            )

            moderation_result = result["moderation"]
            emotion_result = result.get("emotion")
            should_block = result.get("should_block", False)
            skip_reason = result.get("skip_reason")

            # ==========================================
            # 1️⃣ SAVE MODERATION
            # ==========================================
            if task["action"] == EventTypeEnum.ANALYSIS_CREATED.value:

                moderation = await self.moderation_writer.save_created(
                    user_id=task["userId"],
                    target_id=task["targetId"],
                    target_type=task["targetType"],
                    content=task.get("content", ""),
                    moderation_data=moderation_result
                )

            else:
                existing = await self.moderation_repo.get_by_target(
                    target_id=task["targetId"],
                    target_type=task["targetType"]
                )

                if not existing:
                    raise ValueError(
                        f"ModerationResult not found for target {task['targetId']}"
                    )

                moderation = await self.moderation_writer.save_updated(
                    existing=existing,
                    new_content=task.get("content", ""),
                    moderation_data=moderation_result
                )

            if moderation.get("is_violation"):
                await self.outbox.emit_moderation(moderation)

            # ==========================================
            # 2️⃣ SKIP / BLOCK
            # ==========================================
            if skip_reason:
                await self.task_manager.mark_permanent_failed(
                    task["targetId"],
                    task["targetType"],
                    skip_reason
                )
                return

            if should_block or not emotion_result:
                await self.task_manager.mark_permanent_failed(
                    task["targetId"],
                    task["targetType"],
                    "blocked_or_emotion_missing"
                )
                return

            # ==========================================
            # 3️⃣ SAVE EMOTION
            # ==========================================
            if task["action"] == EventTypeEnum.ANALYSIS_CREATED.value:

                emotion = await self.emotion_writer.save_created(
                    user_id=task["userId"],
                    target_id=task["targetId"],
                    target_type=task["targetType"],
                    emotion_data=emotion_result
                )

            else:

                emotion = await self.emotion_writer.save_updated(
                    user_id=task["userId"],
                    target_id=task["targetId"],
                    target_type=task["targetType"],
                    emotion_data=emotion_result
                )

            await self.outbox.emit_emotion(emotion)

            # mark success
            await self.task_repository.update_task(
                task["_id"],
                {
                    "status": "SUCCESS"
                }
            )

        except RetryableException as e:
            logger.warning(f"[RetryWorker] Retryable error: {e}")

            await self.task_repository.update_task(
                task["_id"],
                {
                    "status": "FAILED",
                    "retryCount": task.get("retryCount", 0) + 1,
                    "error": str(e)
                }
            )
            raise

        except Exception as e:
            logger.exception("[RetryWorker] Permanent error")

            await self.task_manager.mark_permanent_failed(
                task["targetId"],
                task["targetType"],
                str(e)
            )
            raise
