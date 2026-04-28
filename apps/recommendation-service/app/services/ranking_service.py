from __future__ import annotations

from typing import Any

import torch

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.models.rerank_request import (
    RecommendationCandidateInput,
    RecommendationRerankRequest,
)
from app.services.rerank_service import RerankService


class RankingService:
    def __init__(
        self,
        repository: RecommendationStateRepository,
        rerank_service: RerankService,
    ):
        self.repository = repository
        self.rerank_service = rerank_service

    def rank_candidates(
        self,
        viewer_id: str,
        viewer_profile_text: str | None,
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not candidates:
            return []

        pair_features = self.repository.get_graph_pair_features(
            viewer_id,
            [str(candidate["candidateId"]) for candidate in candidates],
        )

        rerank_input = candidates[: self._resolve_rerank_top_k()]
        model_scores = self._resolve_model_scores(
            viewer_id=viewer_id,
            viewer_profile_text=viewer_profile_text,
            candidates=rerank_input,
            pair_features=pair_features,
        )

        scored = []
        for candidate in candidates:
            candidate_id = str(candidate["candidateId"])
            pair_feature = pair_features.get(candidate_id, {})

            model_score = float(model_scores.get(candidate_id, 0.0))
            retrieval_score = float(candidate.get("retrievalScore", 0.0))
            graph_score = self._resolve_graph_score(pair_feature)

            scored.append(
                {
                    **candidate,
                    "modelScore": model_score,
                    "mutualFriendCount": int(pair_feature.get("mutualFriendCount", 0)),
                    "commonGroupCount": int(pair_feature.get("commonGroupCount", 0)),
                    "finalScore": self._resolve_final_score(
                        retrieval_score=retrieval_score,
                        model_score=model_score,
                        graph_score=graph_score,
                    ),
                    "reasonCodes": self._build_reason_codes(
                        model_score=model_score,
                        pair_feature=pair_feature,
                    ),
                }
            )

        scored.sort(
            key=lambda candidate: (
                -float(candidate.get("finalScore", 0.0)),
                -float(candidate.get("modelScore", 0.0)),
                -float(candidate.get("retrievalScore", 0.0)),
                str(candidate.get("candidateId", "")),
            )
        )

        for index, candidate in enumerate(scored):
            candidate["rank"] = index + 1

        return scored

    def passthrough_fallback_candidates(
        self,
        candidates: list[dict[str, Any]],
        start_rank: int = 1,
    ) -> list[dict[str, Any]]:
        ranked: list[dict[str, Any]] = []
        for index, candidate in enumerate(candidates):
            ranked.append(
                {
                    **candidate,
                    "modelScore": 0.0,
                    "finalScore": float(candidate.get("retrievalScore", 0.0)),
                    "reasonCodes": ["global_fallback"],
                    "rank": start_rank + index,
                    "mutualFriendCount": 0,
                    "commonGroupCount": 0,
                }
            )
        return ranked

    def _resolve_model_scores(
        self,
        viewer_id: str,
        viewer_profile_text: str | None,
        candidates: list[dict[str, Any]],
        pair_features: dict[str, dict[str, Any]],
    ) -> dict[str, float]:
        if not candidates:
            return {}

        scores = self.rerank_service.rerank(
            RecommendationRerankRequest(
                viewerId=viewer_id,
                viewerProfileText=viewer_profile_text,
                candidates=[
                    RecommendationCandidateInput(
                        candidateId=str(candidate["candidateId"]),
                        candidateProfileText=candidate.get("candidateProfileText"),
                        mutualFriends=int(
                            pair_features.get(str(candidate["candidateId"]), {}).get(
                                "mutualFriendCount", 0
                            )
                        ),
                        commonGroups=int(
                            pair_features.get(str(candidate["candidateId"]), {}).get(
                                "commonGroupCount", 0
                            )
                        ),
                    )
                    for candidate in candidates
                ],
            )
        )
        return {score.candidateId: float(score.modelScore) for score in scores}

    def _resolve_final_score(
        self,
        retrieval_score: float,
        model_score: float,
        graph_score: float,
    ) -> float:
        total_weight = (
            settings.RECOMMENDATION_QUERY_MODEL_WEIGHT
            + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
            + settings.RECOMMENDATION_QUERY_GRAPH_WEIGHT
        )
        if total_weight <= 0:
            return 0.0

        return round(
            (
                settings.RECOMMENDATION_QUERY_MODEL_WEIGHT * self._clamp_score(model_score)
                + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT * self._clamp_score(retrieval_score)
                + settings.RECOMMENDATION_QUERY_GRAPH_WEIGHT * self._clamp_score(graph_score)
            ) / total_weight,
            6,
        )

    def _resolve_graph_score(self, pair_feature: dict[str, Any] | None) -> float:
        if not pair_feature:
            return 0.0

        mutual_friend_cap = max(1, int(settings.RECOMMENDATION_MUTUAL_FRIEND_CAP))
        common_group_cap = max(1, int(settings.RECOMMENDATION_COMMON_GROUP_CAP))

        mutual_friend_score = min(
            int(pair_feature.get("mutualFriendCount", 0)),
            mutual_friend_cap,
        ) / mutual_friend_cap

        common_group_score = min(
            int(pair_feature.get("commonGroupCount", 0)),
            common_group_cap,
        ) / common_group_cap

        recent_event_score = 0.0
        last_event_type = str(pair_feature.get("lastEventType") or "").strip()
        if last_event_type in {
            "recommendation.graph.user-unblocked",
            "recommendation.graph.friend-request-canceled",
        }:
            recent_event_score = 0.1

        return self._clamp_score(
            0.7 * mutual_friend_score
            + 0.2 * common_group_score
            + recent_event_score
        )

    def _build_reason_codes(
        self,
        model_score: float,
        pair_feature: dict[str, Any] | None = None,
    ) -> list[str]:
        reasons = ["semantic_retrieval"]
        if model_score > 0:
            reasons.append("semantic_rerank")

        if not pair_feature:
            return reasons

        if int(pair_feature.get("mutualFriendCount", 0)) > 0:
            reasons.append("graph_mutual_friend")
        if int(pair_feature.get("commonGroupCount", 0)) > 0:
            reasons.append("graph_common_group")
        if self._resolve_graph_score(pair_feature) > 0:
            reasons.append("graph_rerank")

        last_event_type = str(pair_feature.get("lastEventType") or "").strip()
        if last_event_type == "recommendation.graph.user-unblocked":
            reasons.append("graph_recent_unblock")
        elif last_event_type == "recommendation.graph.friend-request-canceled":
            reasons.append("graph_recent_request_canceled")
        elif last_event_type == "recommendation.graph.friendship-removed":
            reasons.append("graph_recent_friendship_removed")

        return reasons

    def _clamp_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))

    def _resolve_rerank_top_k(self) -> int:
        if torch.cuda.is_available():
            return max(1, int(settings.RECOMMENDATION_QUERY_RERANK_TOP_K))

        return max(
            1,
            min(
                int(settings.RECOMMENDATION_QUERY_RERANK_TOP_K),
                int(settings.RECOMMENDATION_QUERY_RERANK_TOP_K_CPU),
            ),
        )
