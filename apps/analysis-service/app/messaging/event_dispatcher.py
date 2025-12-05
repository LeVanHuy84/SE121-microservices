from app.enums.event_enum import EventType
from app.services.handle_event_service import HandleEventService
from app.database.models.outbox_schema import Outbox
from app.database.outbox_repository import OutboxRepository


class EventDispatcher:

    def __init__(self, handler_service: HandleEventService, outbox_repo: OutboxRepository):
        self.handler_service = handler_service
        self.outbox_repo = outbox_repo

        self.handlers = {
            EventType.ANALYSIS_CREATED: handler_service.handle_created,
            EventType.ANALYSIS_UPDATED: handler_service.handle_updated,
        }

    async def dispatch(self, event: dict):
        raw_type = event.get("type")
        payload = event.get("payload")

        # convert string -> Enum
        try:
            event_type = EventType(raw_type)
        except ValueError:
            print(f"[WARN] No handler for event: {raw_type}")
            return None

        # 1) Gọi handler chính
        handler = self.handlers[event_type]
        result = await handler(payload)

        # 2) Chuẩn hoá dữ liệu gửi qua Outbox
        final_emotion = result.final_emotion
        final_scores = result.final_scores.dict()  # Cần xem thêm
        final_score_value = final_scores.get(final_emotion)

        outbox_data = {
            "targetId": payload.get("targetId"),
            "targetType": payload.get("targetType"),
            "finalEmotion": final_emotion.upper() if final_emotion else None,
            "score": final_score_value,
        }

        # 3) Lưu Outbox
        outbox = Outbox(
            topic="analysis-result-events",
            event_type=event_type.value,
            payload=outbox_data,
        )

        await self.outbox_repo.save_outbox(outbox)

        return result
