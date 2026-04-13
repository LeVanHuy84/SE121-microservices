import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.model_loader import model_loader
from app.services.precompute_queue import RecommendationPrecomputeQueue

logger = logging.getLogger(__name__)


class ProfileEmbeddingEventHandler:
    REQUESTED_EVENT_TYPE = "recommendation.profile.embedding.requested"

    def __init__(
        self,
        repository: RecommendationStateRepository,
        precompute_queue: RecommendationPrecomputeQueue,
    ):
        self.repository = repository
        self.precompute_queue = precompute_queue

    async def handle(self, message: dict[str, Any]):
        event_type = str(message.get("type") or "")
        payload = message.get("payload") or {}

        if event_type != self.REQUESTED_EVENT_TYPE:
            logger.warning(
                "Skipping unsupported recommendation event type=%s", event_type
            )
            return

        user_id = str(payload.get("userId") or "").strip()
        request_id = str(payload.get("requestId") or "").strip()
        profile_text = payload.get("semanticProfileText")
        normalized_profile_text = (
            profile_text.strip() if isinstance(profile_text, str) else None
        )

        if not user_id or not request_id:
            logger.warning(
                "Skipping invalid recommendation profile event payload=%s", payload
            )
            return

        try:
            if normalized_profile_text is None:
                self.repository.delete_profile_embedding(user_id)
                self.precompute_queue.mark_stale(user_id)
                logger.info(
                    (
                        "Recommendation profile embedding cleared: "
                        "userId=%s requestId=%s"
                    ),
                    user_id,
                    request_id,
                )
                return

            existing_embedding = self.repository.get_profile_embedding(user_id)
            if (
                existing_embedding
                and existing_embedding.get("semanticProfileText")
                == normalized_profile_text
                and int(existing_embedding.get("dimensions") or 0) > 0
            ):
                logger.debug(
                    (
                        "Skipping unchanged recommendation embedding event: "
                        "userId=%s requestId=%s"
                    ),
                    user_id,
                    request_id,
                )
                return

            embedding = []
            embeddings = model_loader.encode_profile_texts([normalized_profile_text])
            embedding = embeddings[0] if embeddings else []

            generated_at = self._now_iso()
            self.repository.upsert_profile_embedding(
                user_id,
                normalized_profile_text,
                embedding,
                settings.RECOMMENDATION_MODEL_NAME,
                generated_at,
            )
            self.precompute_queue.mark_stale(user_id)
            logger.info(
                "Recommendation profile embedding updated: userId=%s requestId=%s dimensions=%s",
                user_id,
                request_id,
                len(embedding),
            )
        except Exception:
            logger.exception(
                "Recommendation profile embedding failed: userId=%s requestId=%s",
                user_id,
                request_id,
            )

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
