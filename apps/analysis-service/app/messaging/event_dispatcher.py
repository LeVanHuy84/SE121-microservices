from app.enums.event_enum import EventTypeEnum
from app.services.orchestration.handle_event_service import HandleEventService


class EventDispatcher:

    def __init__(self, handler_service: HandleEventService):
        self.handler_service = handler_service

        self.handlers = {
            EventTypeEnum.ANALYSIS_CREATED: handler_service.handle_created,
            EventTypeEnum.ANALYSIS_UPDATED: handler_service.handle_updated,
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
                event_type = EventTypeEnum(raw_type)
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

        except Exception as e:
            print(f"[DISPATCHER] FATAL ERROR: {type(e).__name__}: {str(e)}")
            raise
