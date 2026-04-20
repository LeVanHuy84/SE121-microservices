from __future__ import annotations

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
        locale: str | None = None,
        language: str | None = None,
    ) -> tuple[list[dict[str, Any]], bool]:
        safe_offset = max(0, int(offset))
        safe_size = max(1, int(size))
        excluded_ids = {str(candidate_id) for candidate_id in (excluded_candidate_ids or set())}
        excluded_ids.add(str(viewer_id))

        target_count = safe_size + 1
        cursor = safe_offset
        source_exhausted = False
        filtered_candidates: list[dict[str, Any]] = []

        chunk_size = max(50, safe_size * 5)
        max_scan_rows = max(300, safe_size * 50)
        scanned_rows = 0

        while len(filtered_candidates) < target_count and scanned_rows < max_scan_rows:
            rows = self.repository.list_global_fallback_candidates(
                offset=cursor,
                limit=chunk_size,
                locale=locale,
                language=language,
            )
            if not rows:
                source_exhausted = True
                break

            scanned_rows += len(rows)
            cursor += len(rows)
            source_exhausted = len(rows) < chunk_size

            raw_candidate_ids = [str(row["candidateId"]) for row in rows]
            graph_excluded_ids = self.repository.get_graph_excluded_candidate_ids(
                viewer_id,
                raw_candidate_ids,
            )

            for row in rows:
                candidate_id = str(row["candidateId"])
                if candidate_id in excluded_ids:
                    continue
                if candidate_id in graph_excluded_ids:
                    continue

                filtered_candidates.append(
                    {
                        "candidateId": candidate_id,
                        "candidateProfileText": None,
                        "retrievalScore": float(row["fallbackScore"]),
                        "source": "global_fallback",
                    }
                )

                if len(filtered_candidates) >= target_count:
                    break

            if source_exhausted:
                break

        has_next = len(filtered_candidates) > safe_size
        if not has_next and not source_exhausted and scanned_rows >= max_scan_rows:
            has_next = True

        return filtered_candidates[:safe_size], has_next