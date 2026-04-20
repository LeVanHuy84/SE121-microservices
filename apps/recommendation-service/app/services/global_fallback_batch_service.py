from __future__ import annotations

import heapq
import math
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository

GLOBAL_FALLBACK_SCORE_VERSION = "global-fallback-v2"


class GlobalFallbackBatchService:
    def __init__(self, repository: RecommendationStateRepository):
        self.repository = repository

    def refresh_candidates(
        self,
        top_k: int | None = None,
        locale: str | None = None,
        language: str | None = None,
    ) -> int:
        resolved_top_k = max(
            1,
            int(top_k or settings.RECOMMENDATION_GLOBAL_FALLBACK_TOP_K),
        )

        rows = self.repository.list_profile_embeddings()
        if not rows:
            self.repository.replace_global_fallback_candidates(
                candidates=[],
                generated_at=self._now_iso(),
                score_version=GLOBAL_FALLBACK_SCORE_VERSION,
                locale=locale,
                language=language,
            )
            return 0

        candidate_ids = [str(row["userId"]) for row in rows]
        signal_counts = self.repository.get_candidate_negative_signal_counts(candidate_ids)
        now = datetime.now(timezone.utc)

        top_heap: list[tuple[float, str, dict[str, Any]]] = []

        for row in rows:
            candidate_id = str(row["userId"])
            fallback_score = self._resolve_candidate_fallback_score(
                row=row,
                candidate_signals=signal_counts.get(candidate_id, {}),
                now=now,
            )
            if fallback_score is None:
                continue

            payload = {
                "candidateId": candidate_id,
                "fallbackScore": fallback_score,
            }
            item = (fallback_score, candidate_id, payload)

            if len(top_heap) < resolved_top_k:
                heapq.heappush(top_heap, item)
            else:
                heapq.heappushpop(top_heap, item)

        top_candidates = [
            payload
            for _, _, payload in sorted(
                top_heap,
                key=lambda item: (-item[0], item[1]),
            )
        ]

        ranked_candidates = [
            {
                **candidate,
                "rank": index + 1,
            }
            for index, candidate in enumerate(top_candidates)
        ]

        self.repository.replace_global_fallback_candidates(
            candidates=ranked_candidates,
            generated_at=self._now_iso(),
            score_version=GLOBAL_FALLBACK_SCORE_VERSION,
            locale=locale,
            language=language,
        )
        return len(ranked_candidates)

    def _resolve_candidate_fallback_score(
        self,
        row: dict[str, object],
        candidate_signals: dict[str, object],
        now: datetime,
    ) -> float | None:
        completeness_score = self._resolve_profile_completeness_score(row)
        if completeness_score < 0.25:
            return None

        activity_score = self._resolve_activity_score(
            str(row.get("updatedAt") or ""),
            now,
        )
        block_count = int(candidate_signals.get("blockCount", 0))
        dismissal_count = int(candidate_signals.get("dismissalCount", 0))
        safety_score = 1.0 / (1.0 + block_count + 0.5 * dismissal_count)

        return round(
            0.45 * activity_score
            + 0.35 * completeness_score
            + 0.20 * safety_score,
            6,
        )

    def _resolve_profile_completeness_score(self, row: dict[str, object]) -> float:
        semantic_text = str(row.get("semanticProfileText") or "")
        semantic_text_score = min(1.0, len(semantic_text.strip()) / 200.0)
        has_embedding_score = 1.0 if int(row.get("dimensions") or 0) > 0 else 0.0
        return round(0.7 * semantic_text_score + 0.3 * has_embedding_score, 6)

    def _resolve_activity_score(self, updated_at: str, now: datetime) -> float:
        try:
            updated_at_dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            return 0.0

        if updated_at_dt.tzinfo is None:
            updated_at_dt = updated_at_dt.replace(tzinfo=timezone.utc)

        days_since_update = max(0.0, (now - updated_at_dt).total_seconds() / 86400.0)
        return round(math.exp(-days_since_update / 30.0), 6)

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()