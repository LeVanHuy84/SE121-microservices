import logging
from typing import Dict, Any

from app.modules.analysis.services.orchestration.handle.moderation_writer import ModerationWriter
from app.modules.analysis.services.orchestration.handle.emotion_writer import EmotionWriter
from app.modules.analysis.services.orchestration.handle.task_manager import TaskManager
from app.modules.analysis.services.orchestration.handle.outbox_emitter import OutboxEmitter

from app.modules.analysis.enums import TargetTypeEnum, EventTypeEnum
from app.modules.analysis.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)


class HandleEventService:

    def __init__(
        self,
        analysis_flow_service,
        emotion_aggregate_repo,
        moderation_repo,
        task_repo,
        outbox_repo,
    ):
        self.analysis_flow_service = analysis_flow_service

        self.moderation_writer = ModerationWriter(moderation_repo)
        self.emotion_writer = EmotionWriter(emotion_aggregate_repo)
        self.task_manager = TaskManager(task_repo)
        self.outbox = OutboxEmitter(outbox_repo)


    # ======================================================
    # CREATED EVENT
    # ======================================================
    async def handle_created(self, event: dict) -> Dict[str, Any]:

        text = event.get("content", "")
        image_urls = event.get("imageUrls", [])
        user_id = event["userId"]
        target_id = event["targetId"]
        target_type = TargetTypeEnum(event["targetType"])

        try:
            result = await self.analysis_flow_service.analyze_content(
                text=text,
                image_urls=image_urls,
                target_type=target_type,
            )

            moderation_result = result["moderation"]
            emotion_result = result.get("emotion")
            should_block = result.get("shouldBlock", False)
            skip_reason = result.get("skipReason")

            moderation = await self.moderation_writer.save_created(
                user_id=user_id,
                target_id=target_id,
                target_type=target_type,
                content=text,
                moderation_data=moderation_result,
            )

            if skip_reason or should_block or not emotion_result:
                await self.outbox.emit_analysis_result(EventTypeEnum.ANALYSIS_CREATED, moderation, None)
                return {
                    "moderation": moderation,
                    "emotion": None,
                    "shouldBlock": should_block,
                    "skipReason": skip_reason,
                }

            emotion_result["content"] = text
            emotion = await self.emotion_writer.save_created(
                user_id=user_id,
                target_id=target_id,
                target_type=target_type,
                emotion_data=emotion_result,
            )

            await self.outbox.emit_analysis_result(EventTypeEnum.ANALYSIS_CREATED, moderation, emotion)

            return {
                "moderation": moderation,
                "emotion": emotion,
                "shouldBlock": False,
            }

        except RetryableException as e:

            await self.task_manager.upsert_failed_task(
                user_id=user_id,
                target_id=target_id,
                target_type=target_type,
                action=EventTypeEnum.ANALYSIS_CREATED,
                reason=str(e),
                content=text,
                image_urls=image_urls,
            )

        except Exception as e:

            await self.task_manager.mark_permanent_failed(
                target_id=target_id,
                target_type=target_type,
                reason=str(e),
            )

            raise

    # ======================================================
    # UPDATED EVENT
    # ======================================================
    async def handle_updated(self, event: dict) -> Dict[str, Any]:

        new_text = event.get("content", "")
        image_urls = event.get("imageUrls")
        user_id = event.get("userId")
        target_id = event["targetId"]
        target_type = TargetTypeEnum(event["targetType"])

        # Fallback to DB if imageUrls or userId is not provided in event
        if image_urls is None or not user_id:
            try:
                existing_record = await self.emotion_writer.emotion_aggregate_repo.get_by_target(
                    targetId=target_id,
                    targetType=target_type.value,
                )
                if existing_record:
                    if image_urls is None:
                        image_urls = existing_record.get("imageUrls", [])
                    if not user_id:
                        user_id = existing_record.get("userId", "")
            except Exception as ex:
                logger.warning(f"[HandleEvent] Fallback to DB for target {target_id} failed: {ex}")

        if image_urls is None:
            image_urls = []

        try:
            result = await self.analysis_flow_service.analyze_content(
                text=new_text,
                image_urls=image_urls,
                target_type=target_type,
            )

            moderation_result = result["moderation"]
            emotion_result = result.get("emotion")
            should_block = result.get("shouldBlock", False)
            skip_reason = result.get("skipReason")

            moderation = await self.moderation_writer.save_updated(
                target_id=target_id,
                target_type=target_type,
                content=new_text,
                moderation_data=moderation_result,
            )

            if skip_reason or should_block or not emotion_result:
                await self.outbox.emit_analysis_result(EventTypeEnum.ANALYSIS_UPDATED, moderation, None)
                return {
                    "moderation": moderation,
                    "emotion": None,
                    "shouldBlock": should_block,
                    "skipReason": skip_reason,
                }

            emotion_result["content"] = new_text
            emotion = await self.emotion_writer.save_updated(
                target_id=target_id,
                target_type=target_type,
                emotion_data=emotion_result,
            )

            await self.outbox.emit_analysis_result(EventTypeEnum.ANALYSIS_UPDATED, moderation, emotion)

            return {
                "moderation": moderation,
                "emotion": emotion,
                "shouldBlock": False,
            }

        except RetryableException as e:

            await self.task_manager.upsert_failed_task(
                user_id=user_id,
                target_id=target_id,
                target_type=target_type,
                action=EventTypeEnum.ANALYSIS_UPDATED,
                reason=str(e),
                content=new_text,
                image_urls=image_urls,
            )

            raise

        except Exception as e:

            await self.task_manager.mark_permanent_failed(
                target_id=target_id,
                target_type=target_type,
                reason=str(e),
            )

            raise
