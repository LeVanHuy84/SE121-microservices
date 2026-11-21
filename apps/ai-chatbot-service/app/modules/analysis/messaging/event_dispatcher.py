import logging
from app.modules.analysis.enums import EventTypeEnum
from app.modules.analysis.services.orchestration.handle_event_service import (
    HandleEventService,
)

logger = logging.getLogger(__name__)


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
                logger.warning("[DISPATCHER] Invalid event format: %s", event)
                return None

            # convert string -> Enum
            try:
                event_type = EventTypeEnum(raw_type)
            except ValueError:
                logger.warning("[DISPATCHER] No handler for event: %s", raw_type)
                return None

            # 1) Gọi handler chính
            handler = self.handlers.get(event_type)
            if not handler:
                logger.warning("[DISPATCHER] No handler registered for: %s", event_type)
                return None

            result = await handler(payload)

            if not result:
                logger.debug("[DISPATCHER] Handler returned None")
                return None

        except Exception as e:
            logger.error("[DISPATCHER] FATAL ERROR: %s: %s", type(e).__name__, str(e))
            raise
