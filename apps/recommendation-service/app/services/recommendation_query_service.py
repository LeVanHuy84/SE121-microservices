from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import (
    RecommendationStateRepository,
)
from app.models.rerank_request import (
    RecommendationCandidateInput,
    RecommendationQueryOutput,
    RecommendationQueryRequest,
    RecommendationRerankRequest,
)
from app.services.precompute_service import PRECOMPUTE_SCORE_VERSION
from app.services.rerank_service import RerankService

logger = logging.getLogger(__name__)
QUERY_SCORE_VERSION = "recommendation-query-v1"


class RecommendationQueryService:
    def __init__(
        self,
        repository: RecommendationStateRepository,
        rerank_service: RerankService,
    ):
        self.repository = repository
        self.rerank_service = rerank_service

    def query(self, request: RecommendationQueryRequest) -> RecommendationQueryOutput:
        normalized_viewer_id = str(request.viewerId or "").strip()
        generated_at = self._now_iso()

        if not normalized_viewer_id:
            return RecommendationQueryOutput(
                viewerId="",
                generatedAt=generated_at,
                source="empty",
                scoreVersion=QUERY_SCORE_VERSION,
                candidateCount=0,
                candidates=[],
            )

        # Cursor-based serving will move here in the next phase. For now, the
        # query endpoint establishes ownership of retrieval/scoring in one place.
        precomputed_response = self._build_precomputed_response(
            normalized_viewer_id,
            request.limit,
            generated_at,
        )
        if precomputed_response is not None:
            return precomputed_response

        return self._build_online_response(
            normalized_viewer_id,
            request.limit,
            request.viewerProfileText,
            generated_at,
        )

    def _build_precomputed_response(
        self,
        viewer_id: str,
        limit: int,
        generated_at: str,
    ) -> RecommendationQueryOutput | None:
        snapshot = self.repository.get_precomputed_snapshot(viewer_id, limit)
        if snapshot is None or not snapshot["candidates"]:
            return None

        snapshot_generated_at = str(snapshot.get("generatedAt") or "").strip()
        if not snapshot_generated_at:
            return None

        snapshot_age_seconds = self._resolve_age_seconds(snapshot_generated_at)
        if snapshot_age_seconds is None:
            logger.warning(
                (
                    "Recommendation query ignored snapshot with invalid generatedAt: "
                    "viewerId=%s generatedAt=%s"
                ),
                viewer_id,
                snapshot_generated_at,
            )
            return None

        if snapshot_age_seconds > settings.RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS:
            logger.debug(
                (
                    "Recommendation query ignored stale snapshot: viewerId=%s "
                    "ageSeconds=%s maxAgeSeconds=%s"
                ),
                viewer_id,
                snapshot_age_seconds,
                settings.RECOMMENDATION_PRECOMPUTED_MAX_AGE_SECONDS,
            )
            return None

        # Phase 1 keeps precomputed serving simple and read-only. The next phase
        # will move snapshot pagination and richer rerank/fallback logic here.
        return RecommendationQueryOutput(
            viewerId=viewer_id,
            generatedAt=generated_at,
            source="precomputed",
            scoreVersion=str(snapshot.get("scoreVersion") or PRECOMPUTE_SCORE_VERSION),
            candidateCount=len(snapshot["candidates"]),
            candidates=[
                {
                    "candidateId": str(candidate["candidateId"]),
                    "source": "precomputed",
                    "retrievalScore": float(candidate["retrievalScore"]),
                    "modelScore": 0.0,
                    "finalScore": float(candidate["retrievalScore"]),
                    "scoreVersion": str(
                        snapshot.get("scoreVersion") or PRECOMPUTE_SCORE_VERSION
                    ),
                    "reasonCodes": ["precomputed_snapshot"],
                    "rank": int(candidate["rank"]),
                }
                for candidate in snapshot["candidates"][:limit]
            ],
        )

    def _build_online_response(
        self,
        viewer_id: str,
        limit: int,
        viewer_profile_text_override: str | None,
        generated_at: str,
    ) -> RecommendationQueryOutput:
        viewer_row = self.repository.get_profile_embedding(viewer_id)
        if viewer_row is None or not viewer_row["embedding"]:
            return RecommendationQueryOutput(
                viewerId=viewer_id,
                generatedAt=generated_at,
                source="semantic_online",
                scoreVersion=QUERY_SCORE_VERSION,
                candidateCount=0,
                candidates=[],
            )

        candidate_rows = self.repository.list_profile_embeddings()
        graph_excluded_candidate_ids = self.repository.get_graph_excluded_candidate_ids(
            viewer_id,
            [str(candidate_row["userId"]) for candidate_row in candidate_rows],
        )

        retrieval_candidates: list[dict[str, Any]] = []
        viewer_embedding = [float(value) for value in viewer_row["embedding"]]

        for candidate_row in candidate_rows:
            candidate_id = str(candidate_row["userId"])
            candidate_embedding = [float(value) for value in candidate_row["embedding"]]

            if candidate_id in graph_excluded_candidate_ids or not candidate_embedding:
                continue

            retrieval_score = self._dot_product(viewer_embedding, candidate_embedding)
            if not math.isfinite(retrieval_score):
                continue

            clamped_retrieval_score = self._clamp_score(retrieval_score)
            retrieval_candidates.append(
                {
                    "candidateId": candidate_id,
                    "candidateProfileText": candidate_row["semanticProfileText"],
                    "retrievalScore": clamped_retrieval_score,
                }
            )

        retrieval_candidates.sort(
            key=lambda candidate: (
                -float(candidate["retrievalScore"]),
                str(candidate["candidateId"]),
            )
        )

        rerank_candidates = retrieval_candidates[
            : settings.RECOMMENDATION_QUERY_RERANK_TOP_K
        ]
        viewer_profile_text = (
            viewer_profile_text_override
            if isinstance(viewer_profile_text_override, str)
            and viewer_profile_text_override.strip()
            else viewer_row["semanticProfileText"]
        )
        model_scores = self._resolve_model_scores(
            viewer_id,
            viewer_profile_text,
            rerank_candidates,
        )

        scored_candidates = [
            {
                **candidate,
                "modelScore": model_scores.get(candidate["candidateId"], 0.0),
                "finalScore": self._resolve_final_score(
                    candidate["retrievalScore"],
                    model_scores.get(candidate["candidateId"], 0.0),
                ),
            }
            for candidate in retrieval_candidates
        ]
        scored_candidates.sort(
            key=lambda candidate: (
                -float(candidate["finalScore"]),
                -float(candidate["modelScore"]),
                -float(candidate["retrievalScore"]),
                str(candidate["candidateId"]),
            )
        )

        return RecommendationQueryOutput(
            viewerId=viewer_id,
            generatedAt=generated_at,
            source="semantic_online",
            scoreVersion=QUERY_SCORE_VERSION,
            candidateCount=min(len(scored_candidates), limit),
            candidates=[
                {
                    "candidateId": str(candidate["candidateId"]),
                    "source": "semantic_online",
                    "retrievalScore": float(candidate["retrievalScore"]),
                    "modelScore": float(candidate["modelScore"]),
                    "finalScore": float(candidate["finalScore"]),
                    "scoreVersion": QUERY_SCORE_VERSION,
                    "reasonCodes": self._build_reason_codes(candidate),
                    "rank": index + 1,
                }
                for index, candidate in enumerate(scored_candidates[:limit])
            ],
        )

    def _resolve_model_scores(
        self,
        viewer_id: str,
        viewer_profile_text: str | None,
        candidates: list[dict[str, Any]],
    ) -> dict[str, float]:
        if not candidates:
            return {}

        resolved_scores = self.rerank_service.rerank(
            RecommendationRerankRequest(
                viewerId=viewer_id,
                viewerProfileText=viewer_profile_text,
                candidates=[
                    RecommendationCandidateInput(
                        candidateId=str(candidate["candidateId"]),
                        candidateProfileText=candidate["candidateProfileText"],
                    )
                    for candidate in candidates
                ],
            )
        )
        return {score.candidateId: float(score.modelScore) for score in resolved_scores}

    def _resolve_final_score(
        self,
        retrieval_score: float,
        model_score: float,
    ) -> float:
        normalized_total_weight = (
            settings.RECOMMENDATION_QUERY_MODEL_WEIGHT
            + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
        )
        return round(
            (
                settings.RECOMMENDATION_QUERY_MODEL_WEIGHT
                * self._clamp_score(model_score)
                + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
                * self._clamp_score(retrieval_score)
            )
            / normalized_total_weight,
            6,
        )

    def _build_reason_codes(self, candidate: dict[str, Any]) -> list[str]:
        reason_codes = ["semantic_retrieval"]
        if float(candidate.get("modelScore", 0.0)) > 0:
            reason_codes.append("semantic_rerank")
        return reason_codes

    def _resolve_age_seconds(self, generated_at: str) -> float | None:
        try:
            generated_at_dt = datetime.fromisoformat(
                generated_at.replace("Z", "+00:00")
            )
        except ValueError:
            return None

        if generated_at_dt.tzinfo is None:
            generated_at_dt = generated_at_dt.replace(tzinfo=timezone.utc)

        return max(
            0.0,
            (datetime.now(timezone.utc) - generated_at_dt).total_seconds(),
        )

    def _dot_product(self, left: list[float], right: list[float]) -> float:
        if len(left) == 0 or len(right) == 0 or len(left) != len(right):
            return 0.0

        return sum(float(a) * float(b) for a, b in zip(left, right, strict=False))

    def _clamp_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
