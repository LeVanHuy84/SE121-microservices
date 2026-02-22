import logging
from typing import Dict, Any

from app.services.orchestration.handle.moderation_writer import ModerationWriter
from app.services.orchestration.handle.emotion_writer import EmotionWriter
from app.services.orchestration.handle.task_manager import TaskManager
from app.services.orchestration.handle.outbox_emitter import OutboxEmitter

from app.enums.event_enum import TargetTypeEnum, EventTypeEnum
from app.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)


class HandleEventService:

    def __init__(
        self,
        analysis_flow_service,
        analysis_repo,
        moderation_repo,
        task_repo,
        outbox_repo,
    ):
        self.analysis_flow_service = analysis_flow_service

        self.moderation_writer = ModerationWriter(moderation_repo)
        self.emotion_writer = EmotionWriter(analysis_repo)
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

            if moderation.get("isViolation"):
                await self.outbox.emit_moderation(moderation)

            if skip_reason or should_block or not emotion_result:
                return {
                    "moderation": moderation,
                    "emotion": None,
                    "shouldBlock": should_block,
                    "skipReason": skip_reason,
                }

            emotion = await self.emotion_writer.save_created(
                user_id=user_id,
                target_id=target_id,
                target_type=target_type,
                emotion_data=emotion_result,
            )

            await self.outbox.emit_emotion(EventTypeEnum.ANALYSIS_CREATED, emotion)

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
        user_id = event["userId"]
        target_id = event["targetId"]
        target_type = TargetTypeEnum(event["targetType"])

        try:
            result = await self.analysis_flow_service.analyze_text_only(
                text=new_text,
                target_id=target_id,
                target_type=target_type,
            )

            print(result)

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

            if moderation.get("isViolation"):
                await self.outbox.emit_moderation(moderation)

            if skip_reason or should_block or not emotion_result:
                return {
                    "moderation": moderation,
                    "emotion": None,
                    "shouldBlock": should_block,
                    "skipReason": skip_reason,
                }

            emotion = await self.emotion_writer.save_updated(
                target_id=target_id,
                target_type=target_type,
                emotion_data=emotion_result,
            )


            await self.outbox.emit_emotion(EventTypeEnum.ANALYSIS_UPDATED, emotion)

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
                image_urls=[],
            )

            raise

        except Exception as e:

            await self.task_manager.mark_permanent_failed(
                target_id=target_id,
                target_type=target_type,
                reason=str(e),
            )

            raise
