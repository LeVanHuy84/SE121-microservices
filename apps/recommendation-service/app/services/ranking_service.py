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

        deduped_candidates = self._dedupe_candidates(candidates)
        if not deduped_candidates:
            return []

        pair_features = self.repository.get_graph_pair_features(
            viewer_id,
            [str(candidate["candidateId"]) for candidate in deduped_candidates],
        )

        rerank_input = self._select_rerank_candidates(
            candidates=deduped_candidates,
            pair_features=pair_features,
            top_k=self._resolve_rerank_top_k(),
        )
        model_scores = self._resolve_model_scores(
            viewer_id=viewer_id,
            viewer_profile_text=viewer_profile_text,
            candidates=rerank_input,
            pair_features=pair_features,
        )

        scored = []
        for candidate in deduped_candidates:
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

    def _dedupe_candidates(
        self,
        candidates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for candidate in candidates:
            candidate_id = str(candidate.get("candidateId") or "").strip()
            if not candidate_id or candidate_id in seen_ids:
                continue

            seen_ids.add(candidate_id)
            deduped.append(candidate)

        return deduped

    def _select_rerank_candidates(
        self,
        candidates: list[dict[str, Any]],
        pair_features: dict[str, dict[str, Any]],
        top_k: int,
    ) -> list[dict[str, Any]]:
        resolved_top_k = max(1, int(top_k))
        if len(candidates) <= resolved_top_k:
            return candidates

        # Keep most of the budget for semantic retrieval ordering.
        # Reserve a small portion for graph-strong candidates so
        # mutual-friend signals can influence rerank quality.
        graph_reserve = max(1, resolved_top_k // 3)
        base_semantic_budget = max(1, resolved_top_k - graph_reserve)

        selected = list(candidates[:base_semantic_budget])
        selected_ids = {str(candidate["candidateId"]) for candidate in selected}

        graph_sorted_candidates = sorted(
            candidates,
            key=lambda candidate: (
                -int(
                    pair_features.get(str(candidate["candidateId"]), {}).get(
                        "mutualFriendCount",
                        0,
                    )
                ),
                -float(candidate.get("retrievalScore", 0.0)),
                str(candidate.get("candidateId", "")),
            ),
        )

        for candidate in graph_sorted_candidates:
            candidate_id = str(candidate["candidateId"])
            if candidate_id in selected_ids:
                continue

            selected.append(candidate)
            selected_ids.add(candidate_id)
            if len(selected) >= resolved_top_k:
                break

        return selected

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
        mutual_friend_score = min(
            int(pair_feature.get("mutualFriendCount", 0)),
            mutual_friend_cap,
        ) / mutual_friend_cap

        recent_event_score = 0.0
        last_event_type = str(pair_feature.get("lastEventType") or "").strip()
        if last_event_type in {
            "recommendation.graph.user-unblocked",
            "recommendation.graph.friend-request-canceled",
        }:
            recent_event_score = 0.1

        return self._clamp_score(
            0.7 * mutual_friend_score
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
