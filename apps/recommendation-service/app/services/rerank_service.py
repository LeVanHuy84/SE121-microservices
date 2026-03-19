from typing import List

from app.models.rerank_request import (
    FriendRecommendationOutput,
    RecommendationCandidateInput,
    RecommendationCandidateScore,
    RecommendationRerankRequest,
)
from app.services.model_loader import model_loader


class RerankService:
    def rerank(
        self,
        request: RecommendationRerankRequest,
    ) -> List[RecommendationCandidateScore]:
        valid_candidates = [
            candidate
            for candidate in request.candidates
            if not candidate.alreadyFriend
            and not candidate.isBlocked
            and not candidate.isReported
        ]
        if not valid_candidates:
            return []

        similarity_scores = self._resolve_similarity_scores(
            request.viewerId,
            valid_candidates,
        )

        return [
            RecommendationCandidateScore(
                candidateId=candidate.candidateId,
                modelScore=self._clamp_score(
                    similarity_scores.get(candidate.candidateId, 0.0)
                ),
                reason=self._build_reason(
                    candidate,
                    self._clamp_score(candidate.interactionScore),
                    self._clamp_score(
                        similarity_scores.get(candidate.candidateId, 0.0)
                    ),
                ),
            )
            for candidate in valid_candidates
        ]

    def recommend(
        self,
        request: RecommendationRerankRequest,
    ) -> List[FriendRecommendationOutput]:
        valid_candidates = [
            candidate
            for candidate in request.candidates
            if not candidate.alreadyFriend
            and not candidate.isBlocked
            and not candidate.isReported
        ]

        if not valid_candidates:
            return []

        similarity_scores = self._resolve_similarity_scores(
            request.viewerId,
            valid_candidates,
        )
        max_mutual_friends = max(
            max(candidate.mutualFriends, 0) for candidate in valid_candidates
        )
        if max_mutual_friends <= 0:
            max_mutual_friends = 1

        ranked = []
        for candidate in valid_candidates:
            mutual_friend_score = min(
                1.0,
                max(candidate.mutualFriends, 0) / max_mutual_friends,
            )
            interaction_score = self._clamp_score(candidate.interactionScore)
            similarity_score = self._clamp_score(
                similarity_scores.get(candidate.candidateId, 0.0)
            )
            final_score = (
                0.5 * mutual_friend_score
                + 0.3 * interaction_score
                + 0.2 * similarity_score
            )

            ranked.append(
                FriendRecommendationOutput(
                    user_id=candidate.candidateId,
                    score=round(final_score, 6),
                    reason=self._build_reason(
                        candidate,
                        interaction_score,
                        similarity_score,
                    ),
                )
            )

        ranked.sort(
            key=lambda item: (
                -item.score,
                -self._get_mutual_friends(valid_candidates, item.user_id),
                item.user_id,
            )
        )

        return ranked[:10]

    def _build_prompt(self, viewer_id: str, candidate: RecommendationCandidateInput) -> str:
        reasons = ", ".join(candidate.reasons) if candidate.reasons else "suggested for you"
        return (
            f"viewer={viewer_id} "
            f"candidate={candidate.candidateId} "
            f"mutual_friends={candidate.mutualFriends} "
            f"interaction_score={candidate.interactionScore:.4f} "
            f"shared_interest_count={candidate.sharedInterestCount} "
            f"common_groups={candidate.commonGroups} "
            f"base_score={candidate.baseScore:.2f} "
            f"reasons={reasons}"
        )

    def _resolve_similarity_scores(
        self,
        viewer_id: str,
        candidates: List[RecommendationCandidateInput],
    ) -> dict[str, float]:
        resolved: dict[str, float] = {}
        candidates_to_predict: List[RecommendationCandidateInput] = []

        for candidate in candidates:
            if candidate.similarityScore is not None:
                resolved[candidate.candidateId] = self._clamp_score(
                    candidate.similarityScore
                )
            else:
                candidates_to_predict.append(candidate)

        if not candidates_to_predict:
            return resolved

        prompts = [
            self._build_prompt(viewer_id, candidate)
            for candidate in candidates_to_predict
        ]
        predicted_scores = model_loader.predict_scores(prompts)

        for candidate, predicted_score in zip(candidates_to_predict, predicted_scores):
            resolved[candidate.candidateId] = self._clamp_score(predicted_score)

        return resolved

    def _build_reason(
        self,
        candidate: RecommendationCandidateInput,
        interaction_score: float,
        similarity_score: float,
    ) -> str:
        reason_parts: List[str] = []

        if candidate.mutualFriends > 0:
            reason_parts.append(
                f"Co {candidate.mutualFriends} ban chung"
            )

        if interaction_score >= 0.6:
            reason_parts.append("co tuong tac gan day")

        if candidate.sharedInterestCount > 0:
            reason_parts.append(
                f"co {candidate.sharedInterestCount} so thich tuong dong"
            )
        elif similarity_score >= 0.6:
            reason_parts.append("ho so tuong dong")

        if not reason_parts:
            return "Co tin hieu phu hop"

        return " va ".join(reason_parts[:2])

    def _clamp_score(self, value: float) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))

    def _get_mutual_friends(
        self,
        candidates: List[RecommendationCandidateInput],
        user_id: str,
    ) -> int:
        for candidate in candidates:
            if candidate.candidateId == user_id:
                return candidate.mutualFriends
        return 0


rerank_service = RerankService()
