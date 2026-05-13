from __future__ import annotations

import logging
from typing import List

from app.core.config import settings
from app.models.rerank_request import (
    RecommendationCandidateInput,
    RecommendationCandidateScore,
    RecommendationRerankRequest,
)
from app.services.model_loader import model_loader

logger = logging.getLogger(__name__)


class RerankService:
    def rerank(
        self,
        request: RecommendationRerankRequest,
    ) -> List[RecommendationCandidateScore]:
        valid_candidates = self._select_valid_candidates(request.candidates)
        if not valid_candidates:
            return []

        if not model_loader.is_ready():
            logger.warning(
                "Recommendation model not ready; attempting best-effort rerank"
            )

        resolved_similarity_scores = self._resolve_similarity_scores(
            request.viewerProfileText,
            valid_candidates,
        )

        return [
            RecommendationCandidateScore(
                candidateId=candidate.candidateId,
                modelScore=self._clamp_score(
                    resolved_similarity_scores.get(candidate.candidateId, 0.0)
                ),
                reason=self._build_reason_code(
                    candidate,
                    resolved_similarity_scores.get(candidate.candidateId, 0.0),
                ),
            )
            for candidate in valid_candidates
        ]

    def get_runtime_metadata(self) -> dict[str, str]:
        return model_loader.get_model_metadata()

    def _select_valid_candidates(
        self,
        candidates: List[RecommendationCandidateInput],
    ) -> List[RecommendationCandidateInput]:
        deduped_candidates: List[RecommendationCandidateInput] = []
        seen_candidate_ids: set[str] = set()

        for candidate in candidates:
            candidate_id = str(candidate.candidateId).strip()
            if not candidate_id or candidate_id in seen_candidate_ids:
                continue

            seen_candidate_ids.add(candidate_id)

            if candidate.alreadyFriend or candidate.isBlocked or candidate.isReported:
                continue

            deduped_candidates.append(candidate)

        if len(deduped_candidates) > settings.RECOMMENDATION_MAX_CANDIDATES:
            logger.warning(
                "Recommendation rerank truncated candidate batch: requested=%s limit=%s",
                len(deduped_candidates),
                settings.RECOMMENDATION_MAX_CANDIDATES,
            )

        return deduped_candidates[: settings.RECOMMENDATION_MAX_CANDIDATES]

    def _resolve_similarity_scores(
        self,
        viewer_profile_text: str | None,
        candidates: List[RecommendationCandidateInput],
    ) -> dict[str, float]:
        resolved_scores: dict[str, float] = {}
        candidates_to_predict: List[RecommendationCandidateInput] = []

        for candidate in candidates:
            if not viewer_profile_text or not candidate.candidateProfileText:
                resolved_scores[candidate.candidateId] = 0.0
                continue

            candidates_to_predict.append(candidate)

        if not candidates_to_predict:
            return resolved_scores

        try:
            predicted_scores = model_loader.predict_similarity_scores(
                viewer_profile_text,
                [candidate.candidateProfileText or "" for candidate in candidates_to_predict],
            )
        except Exception:
            logger.exception("Recommendation rerank inference failed")
            for candidate in candidates_to_predict:
                resolved_scores[candidate.candidateId] = 0.0
            return resolved_scores

        for candidate, predicted_score in zip(
            candidates_to_predict,
            predicted_scores,
            strict=False,
        ):
            resolved_scores[candidate.candidateId] = self._clamp_score(predicted_score)

        for candidate in candidates_to_predict[len(predicted_scores):]:
            resolved_scores[candidate.candidateId] = 0.0

        return resolved_scores

    def _build_reason_code(
        self,
        candidate: RecommendationCandidateInput,
        similarity_score: float,
    ) -> str:
        if candidate.mutualFriends > 0 and similarity_score >= 0.6:
            return "graph_mutual_friend_semantic_match"

        if similarity_score >= 0.75:
            return "semantic_strong_match"

        if similarity_score >= 0.5:
            return "semantic_match"

        if candidate.mutualFriends > 0:
            return "graph_mutual_friend"

        return "weak_match"

    def _clamp_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))


rerank_service = RerankService()
