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
        target_size = safe_size + 1
        excluded_ids = {
            str(candidate_id) for candidate_id in (excluded_candidate_ids or set())
        }
        excluded_ids.add(str(viewer_id))

        collected_candidates: list[dict[str, Any]] = []
        cursor = safe_offset
        chunk_size = max(20, safe_size * 4)
        max_scan_rows = max(200, safe_size * 40)
        scanned_rows = 0
        source_exhausted = False

        while scanned_rows < max_scan_rows:
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
            candidate_ids = [
                str(row["candidateId"])
                for row in rows
                if str(row["candidateId"]) not in excluded_ids
            ]
            graph_excluded_ids = self.repository.get_graph_excluded_candidate_ids(
                viewer_id,
                candidate_ids,
            )

            for row in rows:
                candidate_id = str(row["candidateId"])
                if candidate_id in excluded_ids or candidate_id in graph_excluded_ids:
                    continue

                collected_candidates.append(
                    {
                        "candidateId": candidate_id,
                        "candidateProfileText": None,
                        "retrievalScore": float(row["fallbackScore"]),
                        "source": "global_fallback",
                    }
                )

                if len(collected_candidates) >= target_size:
                    break

            if len(collected_candidates) >= target_size:
                break

            if source_exhausted:
                break

        has_next = len(collected_candidates) > safe_size
        if not has_next and not source_exhausted and scanned_rows >= max_scan_rows:
            has_next = True

        return collected_candidates[:safe_size], has_next
