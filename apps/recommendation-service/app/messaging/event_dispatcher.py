import logging
from typing import Any

logger = logging.getLogger(__name__)


class RecommendationEventDispatcher:
    def __init__(self, profile_handler, graph_handler):
        self.profile_handler = profile_handler
        self.graph_handler = graph_handler

        self.profile_event_types = {
            "recommendation.profile.embedding.requested",
        }
        self.graph_event_types = {
            "recommendation.graph.friend-request-sent",
            "recommendation.graph.friend-request-canceled",
            "recommendation.graph.friend-request-accepted",
            "recommendation.graph.friend-request-declined",
            "recommendation.graph.friendship-removed",
            "recommendation.graph.user-blocked",
            "recommendation.graph.user-unblocked",
            "recommendation.graph.recommendation-dismissed",
        }

    async def dispatch(self, event: dict[str, Any]):
        raw_type = str(event.get("type") or "").strip()
        payload = event.get("payload")

        if not raw_type or payload is None:
            logger.warning(
                "Skipping invalid recommendation event format event=%s", event
            )
            return

        if raw_type in self.profile_event_types:
            logger.info(
                (
                    "Dispatching recommendation profile event: type=%s "
                    "userId=%s requestId=%s"
                ),
                raw_type,
                self._payload_value(payload, "userId"),
                self._payload_value(payload, "requestId"),
            )
            await self.profile_handler.handle(event)
            return

        if raw_type in self.graph_event_types:
            logger.info(
                (
                    "Dispatching recommendation graph event: type=%s "
                    "userId=%s targetUserId=%s"
                ),
                raw_type,
                self._payload_value(payload, "userId"),
                self._payload_value(payload, "targetUserId"),
            )
            await self.graph_handler.handle(event)
            return

        logger.warning(
            "No recommendation dispatcher handler for event type=%s", raw_type
        )

    def _payload_value(self, payload: Any, key: str) -> str:
        if not isinstance(payload, dict):
            return ""

        return str(payload.get(key) or "").strip()
