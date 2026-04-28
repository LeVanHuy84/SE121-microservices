import logging
from datetime import datetime, timezone
from typing import Any

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.query_cache import query_cache

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

    def __init__(
        self,
        repository: RecommendationStateRepository,
    ):
        self.repository = repository

    async def handle(self, message: dict[str, Any]):
        event_type = str(message.get("type") or "").strip()
        payload = message.get("payload") or {}

        if event_type not in self.SUPPORTED_EVENT_TYPES:
            logger.warning(
                "Skipping unsupported recommendation graph event type=%s", event_type
            )
            return

        user_id = str(payload.get("userId") or "").strip()
        target_user_id = str(payload.get("targetUserId") or "").strip()

        if not user_id or not target_user_id:
            logger.warning(
                "Skipping invalid recommendation graph event payload=%s", payload
            )
            return

        event_at = self._parse_occurred_at(payload.get("occurredAt"))
        source = str(payload.get("source") or "").strip() or "unknown"
        self.repository.record_graph_event(
            event_type=event_type,
            user_id=user_id,
            target_user_id=target_user_id,
            occurred_at=event_at,
            source=source,
            payload=payload,
        )

        if event_type == "recommendation.graph.friend-request-sent":
            self.repository.apply_graph_friend_request_sent(user_id, target_user_id)
        elif event_type == "recommendation.graph.friend-request-canceled":
            self.repository.apply_graph_friend_request_canceled(
                user_id,
                target_user_id,
            )
        elif event_type == "recommendation.graph.friend-request-accepted":
            self.repository.apply_graph_friend_request_accepted(
                user_id,
                target_user_id,
            )
        elif event_type == "recommendation.graph.friend-request-declined":
            self.repository.apply_graph_friend_request_declined(
                user_id,
                target_user_id,
            )
        elif event_type == "recommendation.graph.friendship-removed":
            self.repository.apply_graph_friendship_removed(user_id, target_user_id)
        elif event_type == "recommendation.graph.user-blocked":
            self.repository.apply_graph_user_blocked(user_id, target_user_id)
        elif event_type == "recommendation.graph.user-unblocked":
            self.repository.apply_graph_user_unblocked(user_id, target_user_id)
        elif event_type == "recommendation.graph.recommendation-dismissed":
            expires_at = self._parse_expires_at(payload.get("expiresAt"))
            if expires_at is None:
                logger.warning(
                    (
                        "Skipping recommendation dismissal event with invalid "
                        "expiresAt payload=%s"
                    ),
                    payload,
                )
                return

            self.repository.apply_graph_recommendation_dismissed(
                user_id, target_user_id, expires_at
            )

        self.repository.refresh_graph_pair_features_for_event(
            user_id=user_id,
            target_user_id=target_user_id,
            event_type=event_type,
            event_at=event_at,
        )

        rows_changed = self._resolve_projection_rows_changed(event_type)
        logger.info(
            (
                "Applied recommendation graph event type=%s userId=%s "
                "targetUserId=%s projectionRowsChanged=%s"
            ),
            event_type,
            user_id,
            target_user_id,
            rows_changed,
        )
        query_cache.invalidate_many([user_id, target_user_id])

    def _parse_expires_at(self, expires_at: Any) -> datetime | None:
        if not isinstance(expires_at, str) or not expires_at.strip():
            return None

        normalized_value = expires_at.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized_value)
        except ValueError:
            return None

    def _parse_occurred_at(self, occurred_at: Any) -> datetime:
        if not isinstance(occurred_at, str) or not occurred_at.strip():
            return datetime.now(timezone.utc)

        normalized_value = occurred_at.strip().replace("Z", "+00:00")
        try:
            parsed_value = datetime.fromisoformat(normalized_value)
            if parsed_value.tzinfo is None:
                return parsed_value.replace(tzinfo=timezone.utc)
            return parsed_value
        except ValueError:
            return datetime.now(timezone.utc)

    def _resolve_projection_rows_changed(self, event_type: str) -> int:
        if event_type in {
            "recommendation.graph.friend-request-sent",
            "recommendation.graph.friend-request-canceled",
            "recommendation.graph.friend-request-declined",
            "recommendation.graph.user-unblocked",
            "recommendation.graph.recommendation-dismissed",
        }:
            return 1

        if event_type in {
            "recommendation.graph.friend-request-accepted",
            "recommendation.graph.friendship-removed",
        }:
            return 2

        if event_type == "recommendation.graph.user-blocked":
            return 5

        return 0
