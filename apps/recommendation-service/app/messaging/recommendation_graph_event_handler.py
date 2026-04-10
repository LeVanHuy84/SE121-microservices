import logging
from datetime import datetime
from typing import Any

from app.services.graph_state_store import graph_state_store
from app.services.precompute_queue import precompute_queue

logger = logging.getLogger(__name__)


class RecommendationGraphEventHandler:
    SUPPORTED_EVENT_TYPES = {
        "recommendation.graph.friend-request-sent",
        "recommendation.graph.friend-request-canceled",
        "recommendation.graph.friend-request-accepted",
        "recommendation.graph.friend-request-declined",
        "recommendation.graph.friendship-removed",
        "recommendation.graph.user-blocked",
        "recommendation.graph.user-unblocked",
        "recommendation.graph.recommendation-dismissed",
    }

    async def handle(self, message: dict[str, Any]):
        event_type = str(message.get("type") or "").strip()
        payload = message.get("payload") or {}

        if event_type not in self.SUPPORTED_EVENT_TYPES:
            logger.warning("Skipping unsupported recommendation graph event type=%s", event_type)
            return

        user_id = str(payload.get("userId") or "").strip()
        target_user_id = str(payload.get("targetUserId") or "").strip()

        if not user_id or not target_user_id:
            logger.warning(
                "Skipping invalid recommendation graph event payload=%s", payload
            )
            return

        if event_type == "recommendation.graph.friend-request-sent":
            graph_state_store.apply_friend_request_sent(user_id, target_user_id)
        elif event_type == "recommendation.graph.friend-request-canceled":
            graph_state_store.apply_friend_request_canceled(user_id, target_user_id)
        elif event_type == "recommendation.graph.friend-request-accepted":
            graph_state_store.apply_friend_request_accepted(user_id, target_user_id)
        elif event_type == "recommendation.graph.friend-request-declined":
            graph_state_store.apply_friend_request_declined(user_id, target_user_id)
        elif event_type == "recommendation.graph.friendship-removed":
            graph_state_store.apply_friendship_removed(user_id, target_user_id)
        elif event_type == "recommendation.graph.user-blocked":
            graph_state_store.apply_user_blocked(user_id, target_user_id)
        elif event_type == "recommendation.graph.user-unblocked":
            graph_state_store.apply_user_unblocked(user_id, target_user_id)
        elif event_type == "recommendation.graph.recommendation-dismissed":
            expires_at = self._parse_expires_at(payload.get("expiresAt"))
            if expires_at is None:
                logger.warning(
                    "Skipping recommendation dismissal event with invalid expiresAt payload=%s",
                    payload,
                )
                return

            graph_state_store.apply_recommendation_dismissed(
                user_id, target_user_id, expires_at
            )

        logger.info(
            "Applied recommendation graph event type=%s userId=%s targetUserId=%s",
            event_type,
            user_id,
            target_user_id,
        )
        precompute_queue.mark_many([user_id, target_user_id])

    def _parse_expires_at(self, expires_at: Any) -> datetime | None:
        if not isinstance(expires_at, str) or not expires_at.strip():
            return None

        normalized_value = expires_at.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized_value)
        except ValueError:
            return None
