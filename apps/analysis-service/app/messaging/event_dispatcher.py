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
        try:
            raw_type = event.get("type")
            payload = event.get("payload")

            if not raw_type or not payload:
                print(f"[DISPATCHER] Invalid event format: {event}")
                return None

            # convert string -> Enum
            try:
                event_type = EventType(raw_type)
            except ValueError:
                print(f"[DISPATCHER] No handler for event: {raw_type}")
                return None

            # 1) Gọi handler chính
            handler = self.handlers.get(event_type)
            if not handler:
                print(f"[DISPATCHER] No handler registered for: {event_type}")
                return None

            result = await handler(payload)

            if not result:
                print("[DISPATCHER] Handler returned None")
                return None

            # 2) Chuẩn hoá dữ liệu gửi qua Outbox (AN TOÀN 100%)
            final_emotion = getattr(result, "finalEmotion", None)
            final_scores = getattr(result, "finalScores", None) or {}

            if not isinstance(final_scores, dict):
                print(f"[DISPATCHER] finalScores is not dict: {type(final_scores)}")
                final_scores = {}

            final_score_value = None
            if final_emotion:
                final_score_value = final_scores.get(final_emotion)

            outbox_data = {
                "targetId": payload.get("targetId"),
                "targetType": payload.get("targetType"),
                "finalEmotion": final_emotion.upper() if isinstance(final_emotion, str) else None,
                "score": final_score_value,
            }

            # 3) Lưu Outbox
            outbox = Outbox(
                topic="analysis-result-events",
                eventType=event_type.value,
                payload=outbox_data,
            )

            await self.outbox_repo.save_outbox(outbox)

            return result

        except Exception as e:
            print(f"[DISPATCHER] FATAL ERROR: {type(e).__name__}: {str(e)}")
            raise
