from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import (
    RecommendationStateRepository,
)

logger = logging.getLogger(__name__)
PRECOMPUTE_SCORE_VERSION = "retrieval-dot-product-v1"


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

        candidates: list[dict[str, Any]] = []
        viewer_embedding = [float(value) for value in viewer_row["embedding"]]
        candidate_rows = self.repository.list_profile_embeddings()
        graph_excluded_candidate_ids = self.repository.get_graph_excluded_candidate_ids(
            viewer_id,
            [str(candidate_row["userId"]) for candidate_row in candidate_rows],
        )

        for candidate_row in candidate_rows:
            candidate_id = str(candidate_row["userId"])
            candidate_embedding = [float(value) for value in candidate_row["embedding"]]

            if candidate_id in graph_excluded_candidate_ids:
                continue

            if not candidate_embedding:
                continue

            retrieval_score = self._dot_product(viewer_embedding, candidate_embedding)
            if not math.isfinite(retrieval_score):
                continue

            clamped_retrieval_score = max(0.0, min(1.0, retrieval_score))
            candidates.append(
                {
                    "candidateId": candidate_id,
                    "retrievalScore": clamped_retrieval_score,
                    "semanticScore": clamped_retrieval_score,
                }
            )

        candidates.sort(
            key=lambda candidate: (
                -float(candidate["retrievalScore"]),
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

    def _dot_product(self, left: list[float], right: list[float]) -> float:
        if len(left) == 0 or len(right) == 0 or len(left) != len(right):
            return 0.0

        return sum(float(a) * float(b) for a, b in zip(left, right, strict=False))

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
