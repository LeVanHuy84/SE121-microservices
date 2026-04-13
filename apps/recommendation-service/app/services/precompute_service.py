from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import (
    RecommendationStateRepository,
)

logger = logging.getLogger(__name__)
PRECOMPUTE_SCORE_VERSION = "retrieval-pgvector-v1"


class RecommendationPrecomputeService:
    def __init__(
        self,
        repository: RecommendationStateRepository,
    ):
        self.repository = repository

    def compute_for_viewer(
        self, viewer_id: str, generation_reason: str = "state-processor"
    ) -> dict[str, Any]:
        viewer_row = self.repository.get_profile_embedding(viewer_id)
        generated_at = self._now_iso()

        if not viewer_row or not viewer_row["embedding"]:
            self.repository.clear_precomputed_snapshot(
                viewer_id,
                generated_at,
                generation_reason,
                settings.RECOMMENDATION_MODEL_NAME,
                PRECOMPUTE_SCORE_VERSION,
            )
            return {
                "viewerId": viewer_id,
                "generatedAt": generated_at,
                "candidateCount": 0,
                "reason": "viewer-missing-embedding",
            }

        candidates = self.repository.search_semantic_candidates(
            viewer_id=viewer_id,
            limit=settings.RECOMMENDATION_PRECOMPUTE_TOP_K,
            overscan=max(
                settings.RECOMMENDATION_PRECOMPUTE_TOP_K,
                settings.RECOMMENDATION_PRECOMPUTE_TOP_K * 3,
            ),
        )
        top_candidates = [
            {
                "candidateId": str(candidate["candidateId"]),
                "retrievalScore": self._clamp_score(candidate["retrievalScore"]),
                "semanticScore": self._clamp_score(candidate["retrievalScore"]),
                "rank": index + 1,
            }
            for index, candidate in enumerate(candidates)
        ]

        self.repository.replace_precomputed_snapshot(
            viewer_id,
            top_candidates,
            generated_at,
            generation_reason,
            settings.RECOMMENDATION_MODEL_NAME,
            PRECOMPUTE_SCORE_VERSION,
        )
        logger.info(
            "Recommendation precompute completed: viewerId=%s candidates=%s reason=%s",
            viewer_id,
            len(top_candidates),
            generation_reason,
        )

        return {
            "viewerId": viewer_id,
            "generatedAt": generated_at,
            "candidateCount": len(top_candidates),
            "reason": generation_reason,
        }

    def _clamp_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
