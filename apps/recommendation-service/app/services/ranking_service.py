from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from app.models.domain import GraphPairFeature, EmotionProfile

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
        emotion_profiles = (
            self.repository.get_emotion_profiles(
                [viewer_id]
                + [str(candidate["candidateId"]) for candidate in deduped_candidates]
            )
            if settings.RECOMMENDATION_EMOTION_SCORING_ENABLED
            else {}
        )
        viewer_emotion = emotion_profiles.get(viewer_id)

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
            pair_feature = pair_features.get(candidate_id)

            model_score = float(model_scores.get(candidate_id, 0.0))
            retrieval_score = float(candidate.get("retrievalScore", 0.0))
            graph_score = self._resolve_graph_score(pair_feature)
            emotion_score = self._resolve_emotion_affinity_score(
                viewer_emotion=viewer_emotion,
                candidate_emotion=emotion_profiles.get(candidate_id),
            )

            scored.append(
                {
                    **candidate,
                    "modelScore": model_score,
                    "emotionScore": emotion_score,
                    "mutualFriendCount": pair_feature.mutual_friend_count if pair_feature else 0,
                    "commonGroupCount": 0,
                    "finalScore": self._resolve_final_score(
                        retrieval_score=retrieval_score,
                        model_score=model_score,
                        graph_score=graph_score,
                        emotion_score=emotion_score,
                    ),
                    "reasonCodes": self._build_reason_codes(
                        model_score=model_score,
                        pair_feature=pair_feature,
                        emotion_score=emotion_score,
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
        pair_features: dict[str, GraphPairFeature],
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
                -pair_features[str(candidate["candidateId"])].mutual_friend_count
                if str(candidate["candidateId"]) in pair_features
                else 0,
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
        pair_features: dict[str, GraphPairFeature],
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
                        mutualFriends=pair_features[str(candidate["candidateId"])].mutual_friend_count
                        if str(candidate["candidateId"]) in pair_features
                        else 0,
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
        emotion_score: float,
    ) -> float:
        return round(
            settings.RECOMMENDATION_QUERY_MODEL_WEIGHT * self._clamp_score(model_score)
            + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT * self._clamp_score(retrieval_score)
            + settings.RECOMMENDATION_QUERY_GRAPH_WEIGHT * self._clamp_score(graph_score)
            + settings.RECOMMENDATION_QUERY_EMOTION_WEIGHT * self._clamp_score(emotion_score),
            6,
        )

    def _resolve_graph_score(self, pair_feature: GraphPairFeature | None) -> float:
        if not pair_feature:
            return 0.0

        mutual_friend_cap = max(1, int(settings.RECOMMENDATION_MUTUAL_FRIEND_CAP))
        mutual_friend_score = min(
            pair_feature.mutual_friend_count,
            mutual_friend_cap,
        ) / mutual_friend_cap

        recent_event_score = 0.0
        last_event_type = pair_feature.last_event_type or ""
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
        pair_feature: GraphPairFeature | None = None,
        emotion_score: float = 0.0,
    ) -> list[str]:
        reasons = ["semantic_retrieval"]
        if model_score > 0:
            reasons.append("semantic_rerank")
        if emotion_score > 0:
            reasons.append("emotion_affinity")

        if not pair_feature:
            return reasons

        if pair_feature.mutual_friend_count > 0:
            reasons.append("graph_mutual_friend")
        if self._resolve_graph_score(pair_feature) > 0:
            reasons.append("graph_rerank")

        last_event_type = pair_feature.last_event_type or ""
        if last_event_type == "recommendation.graph.user-unblocked":
            reasons.append("graph_recent_unblock")
        elif last_event_type == "recommendation.graph.friend-request-canceled":
            reasons.append("graph_recent_request_canceled")
        elif last_event_type == "recommendation.graph.friendship-removed":
            reasons.append("graph_recent_friendship_removed")

        return reasons

    def _resolve_emotion_affinity_score(
        self,
        viewer_emotion: EmotionProfile | None,
        candidate_emotion: EmotionProfile | None,
    ) -> float:
        if not settings.RECOMMENDATION_EMOTION_SCORING_ENABLED:
            return 0.0
        if not viewer_emotion or not candidate_emotion:
            return 0.0
        if self._is_emotion_profile_stale(viewer_emotion) or self._is_emotion_profile_stale(
            candidate_emotion
        ):
            return 0.0

        viewer_negativity = self._clamp_score(viewer_emotion.recent_negativity_score)
        candidate_negativity = self._clamp_score(
            candidate_emotion.recent_negativity_score
        )
        viewer_risk = self._clamp_score(viewer_emotion.risk_score)
        candidate_risk = self._clamp_score(candidate_emotion.risk_score)

        # Prefer complementary pairing (high-negativity viewers with low-negativity candidates)
        # and avoid amplifying high-high risk pairing.
        stability_complementarity = 1.0 - (viewer_negativity + candidate_negativity) / 2.0
        risk_penalty = max(0.0, (viewer_risk + candidate_risk) / 2.0 - 0.7) * 0.5
        
        # Base score rewards complementarity and penalizes candidate's risk
        base_score = 0.75 * stability_complementarity + 0.25 * (1.0 - candidate_risk)
        
        return self._clamp_score(base_score - risk_penalty)

    def _is_emotion_profile_stale(self, profile: EmotionProfile) -> bool:
        if not profile.updated_at:
            return True
        max_age_hours = max(1, int(settings.RECOMMENDATION_EMOTION_DATA_MAX_AGE_HOURS))
        age_seconds = (datetime.now(timezone.utc) - profile.updated_at.replace(tzinfo=timezone.utc)).total_seconds()
        return age_seconds > max_age_hours * 3600

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
