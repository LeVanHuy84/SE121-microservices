import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.model_loader import model_loader
from app.services.precompute_queue import precompute_queue

logger = logging.getLogger(__name__)


class ProfileEmbeddingEventHandler:
    REQUESTED_EVENT_TYPE = "recommendation.profile.embedding.requested"
    COMPLETED_EVENT_TYPE = "recommendation.profile.embedding.completed"
    FAILED_EVENT_TYPE = "recommendation.profile.embedding.failed"

    def __init__(self, repository: RecommendationStateRepository):
        self.repository = repository

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
        schema_version = int(payload.get("schemaVersion") or 1)
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
            embedding = []
            if normalized_profile_text:
                embeddings = model_loader.encode_profile_texts(
                    [normalized_profile_text]
                )
                embedding = embeddings[0] if embeddings else []

            generated_at = self._now_iso()
            self.repository.save_embedding_and_enqueue_result(
                user_id,
                normalized_profile_text,
                embedding,
                settings.RECOMMENDATION_MODEL_NAME,
                generated_at,
                settings.RECOMMENDATION_RESULT_TOPIC,
                self.COMPLETED_EVENT_TYPE,
                {
                    "userId": user_id,
                    "semanticProfileText": normalized_profile_text,
                    "requestId": request_id,
                    "schemaVersion": schema_version,
                    "modelName": settings.RECOMMENDATION_MODEL_NAME,
                    "embedding": embedding,
                    "dimensions": len(embedding),
                    "generatedAt": generated_at,
                },
            )
            precompute_queue.mark_stale(user_id)
            logger.info(
                (
                    "Recommendation profile embedding completed and enqueued: "
                    "userId=%s requestId=%s dimensions=%s"
                ),
                user_id,
                request_id,
                len(embedding),
            )
        except Exception as exc:
            self.repository.enqueue_outbox_event(
                settings.RECOMMENDATION_RESULT_TOPIC,
                self.FAILED_EVENT_TYPE,
                {
                    "userId": user_id,
                    "semanticProfileText": normalized_profile_text,
                    "requestId": request_id,
                    "schemaVersion": schema_version,
                    "modelName": settings.RECOMMENDATION_MODEL_NAME,
                    "error": str(exc),
                    "failedAt": self._now_iso(),
                },
            )
            logger.exception(
                (
                    "Recommendation profile embedding failed and enqueued: "
                    "userId=%s requestId=%s"
                ),
                user_id,
                request_id,
            )

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
