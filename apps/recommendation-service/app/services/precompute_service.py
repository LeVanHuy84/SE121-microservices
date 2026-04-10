from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import (
    RecommendationStateRepository,
)
from app.services.graph_state_store import graph_state_store

logger = logging.getLogger(__name__)


class RecommendationPrecomputeService:
    def __init__(self, repository: RecommendationStateRepository):
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
            )
            return {
                "viewerId": viewer_id,
                "generatedAt": generated_at,
                "candidateCount": 0,
                "reason": "viewer-missing-embedding",
            }

        candidates: list[dict[str, Any]] = []
        viewer_embedding = [float(value) for value in viewer_row["embedding"]]

        for candidate_row in self.repository.list_profile_embeddings():
            candidate_id = str(candidate_row["userId"])
            candidate_embedding = [float(value) for value in candidate_row["embedding"]]

            if not self._is_candidate_eligible(viewer_id, candidate_id):
                continue

            if not candidate_embedding:
                continue

            semantic_score = self._dot_product(viewer_embedding, candidate_embedding)
            if not math.isfinite(semantic_score):
                continue

            candidates.append(
                {
                    "candidateId": candidate_id,
                    "semanticScore": max(0.0, min(1.0, semantic_score)),
                }
            )

        candidates.sort(
            key=lambda candidate: (
                -float(candidate["semanticScore"]),
                str(candidate["candidateId"]),
            )
        )
        top_candidates = [
            {
                **candidate,
                "rank": index + 1,
            }
            for index, candidate in enumerate(
                candidates[: settings.RECOMMENDATION_PRECOMPUTE_TOP_K]
            )
        ]

        self.repository.replace_precomputed_snapshot(
            viewer_id,
            top_candidates,
            generated_at,
            generation_reason,
            settings.RECOMMENDATION_MODEL_NAME,
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

    def _is_candidate_eligible(self, viewer_id: str, candidate_id: str) -> bool:
        if not viewer_id or not candidate_id or viewer_id == candidate_id:
            return False

        if graph_state_store.has_friendship(viewer_id, candidate_id):
            return False

        if graph_state_store.has_friendship(candidate_id, viewer_id):
            return False

        if graph_state_store.has_pending_request(viewer_id, candidate_id):
            return False

        if graph_state_store.has_pending_request(candidate_id, viewer_id):
            return False

        if graph_state_store.is_blocked(viewer_id, candidate_id):
            return False

        if graph_state_store.is_blocked(candidate_id, viewer_id):
            return False

        if graph_state_store.has_active_dismissal(viewer_id, candidate_id):
            return False

        return True

    def _dot_product(self, left: list[float], right: list[float]) -> float:
        if len(left) == 0 or len(right) == 0 or len(left) != len(right):
            return 0.0

        return sum(float(a) * float(b) for a, b in zip(left, right, strict=False))

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
