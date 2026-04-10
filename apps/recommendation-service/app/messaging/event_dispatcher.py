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
            logger.warning("Skipping invalid recommendation event format event=%s", event)
            return

        if raw_type in self.profile_event_types:
            await self.profile_handler.handle(event)
            return

        if raw_type in self.graph_event_types:
            await self.graph_handler.handle(event)
            return

        logger.warning("No recommendation dispatcher handler for event type=%s", raw_type)
