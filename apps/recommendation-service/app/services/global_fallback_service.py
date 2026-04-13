from __future__ import annotations

from datetime import datetime
from typing import Any

from app.database.recommendation_state_repository import RecommendationStateRepository


class GlobalFallbackService:
    def __init__(self, repository: RecommendationStateRepository):
        self.repository = repository

    def get_batch(
        self,
        viewer_id: str,
        offset: int,
        size: int,
        excluded_candidate_ids: set[str] | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        safe_offset = max(0, int(offset))
        safe_size = max(1, int(size))
        excluded_ids = {str(candidate_id) for candidate_id in (excluded_candidate_ids or set())}
        excluded_ids.add(str(viewer_id))

        rows = self.repository.list_profile_embeddings()
        candidate_ids = [str(row["userId"]) for row in rows if str(row["userId"]) not in excluded_ids]
        graph_excluded_ids = self.repository.get_graph_excluded_candidate_ids(
            viewer_id,
            candidate_ids,
        )

        fallback_rows = [
            row
            for row in rows
            if str(row["userId"]) not in excluded_ids
            and str(row["userId"]) not in graph_excluded_ids
        ]

        fallback_rows.sort(
            key=lambda row: self._parse_iso_datetime(str(row.get("updatedAt") or "")),
            reverse=True,
        )

        page_rows = fallback_rows[safe_offset : safe_offset + safe_size + 1]
        candidates = [
            {
                "candidateId": str(row["userId"]),
                "candidateProfileText": row.get("semanticProfileText"),
                "retrievalScore": 0.0,
                "source": "global_fallback",
            }
            for row in page_rows[:safe_size]
        ]

        return candidates, len(page_rows) > safe_size

    def _parse_iso_datetime(self, value: str) -> datetime:
        normalized = value.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return datetime.min
