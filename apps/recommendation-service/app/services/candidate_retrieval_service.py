from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.services.precompute_service import PRECOMPUTE_SCORE_VERSION


@dataclass
class RetrievalBatch:
    source: str
    candidates: list[dict[str, Any]]
    has_next: bool
    score_version: str


class CandidateRetrievalService:
    def __init__(self, repository: RecommendationStateRepository):
        self.repository = repository

    def get_precomputed_batch(
        self,
        viewer_id: str,
        offset: int,
        size: int,
    ) -> RetrievalBatch:
        safe_offset = max(0, int(offset))
        safe_size = max(1, int(size))

        snapshot = self.repository.get_precomputed_snapshot(
            viewer_id,
            safe_offset + safe_size + 1,
        )
        if snapshot is None or not snapshot.get("candidates"):
            return RetrievalBatch(
                source="precomputed",
                candidates=[],
                has_next=False,
                score_version=PRECOMPUTE_SCORE_VERSION,
            )

        generated_at = str(snapshot.get("generatedAt") or "").strip()
        if not generated_at or self._is_snapshot_stale(generated_at):
            return RetrievalBatch(
                source="precomputed",
                candidates=[],
                has_next=False,
                score_version=PRECOMPUTE_SCORE_VERSION,
            )

        rows = snapshot["candidates"][safe_offset : safe_offset + safe_size + 1]
        return RetrievalBatch(
            source="precomputed",
            candidates=[
                {
                    "candidateId": str(row["candidateId"]),
                    "candidateProfileText": None,
                    "retrievalScore": float(row.get("retrievalScore", 0.0)),
                    "source": "precomputed",
                }
                for row in rows[:safe_size]
            ],
            has_next=len(rows) > safe_size,
            score_version=str(snapshot.get("scoreVersion") or PRECOMPUTE_SCORE_VERSION),
        )

    def get_semantic_online_batch(
        self,
        viewer_id: str,
        offset: int,
        size: int,
    ) -> RetrievalBatch:
        safe_offset = max(0, int(offset))
        safe_size = max(1, int(size))
        request_limit = safe_offset + safe_size + 1

        rows = self.repository.search_semantic_candidates(
            viewer_id=viewer_id,
            limit=request_limit,
            overscan=max(request_limit * 3, safe_size * 3),
        )
        page_rows = rows[safe_offset : safe_offset + safe_size + 1]

        return RetrievalBatch(
            source="semantic_online",
            candidates=[
                {
                    "candidateId": str(row["candidateId"]),
                    "candidateProfileText": row.get("candidateProfileText"),
                    "retrievalScore": float(row.get("retrievalScore", 0.0)),
                    "source": "semantic_online",
                }
                for row in page_rows[:safe_size]
            ],
            has_next=len(page_rows) > safe_size,
            score_version="recommendation-query-pipeline-v1",
        )

    def filter_graph_projection(
        self,
        viewer_id: str,
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []

        excluded_ids = self.repository.get_graph_excluded_candidate_ids(
            viewer_id,
            [str(candidate["candidateId"]) for candidate in candidates],
        )

        return [
            candidate
            for candidate in candidates
            if str(candidate["candidateId"]) not in excluded_ids
        ]

    def _is_snapshot_stale(self, generated_at: str) -> bool:
        try:
            generated_at_dt = datetime.fromisoformat(
                generated_at.replace("Z", "+00:00")
            )
        except ValueError:
            return True

        if generated_at_dt.tzinfo is None:
            generated_at_dt = generated_at_dt.replace(tzinfo=timezone.utc)

        age_seconds = (datetime.now(timezone.utc) - generated_at_dt).total_seconds()
        return age_seconds > settings.RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS
