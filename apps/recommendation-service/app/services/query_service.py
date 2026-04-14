from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.models.rerank_request import (
    RecommendationCandidateInput,
    RecommendationQueryOutput,
    RecommendationQueryRequest,
    RecommendationRerankRequest,
)
from app.services.candidate_retrieval_service import CandidateRetrievalService
from app.services.global_fallback_service import GlobalFallbackService
from app.services.query_cache import QueryCache, query_cache
from app.services.rerank_service import RerankService

QUERY_SCORE_VERSION = "recommendation-query-pipeline-v1"


class QueryService:
    def __init__(
        self,
        repository: RecommendationStateRepository,
        rerank_service: RerankService,
        candidate_retrieval_service: CandidateRetrievalService | None = None,
        global_fallback_service: GlobalFallbackService | None = None,
        cache: QueryCache | None = query_cache,
    ):
        self.repository = repository
        self.rerank_service = rerank_service
        self.cache = cache
        self.candidate_retrieval_service = (
            candidate_retrieval_service or CandidateRetrievalService(repository)
        )
        self.global_fallback_service = (
            global_fallback_service or GlobalFallbackService(repository)
        )

    def query(self, request: RecommendationQueryRequest) -> RecommendationQueryOutput:
        viewer_id = str(request.viewerId or "").strip()
        generated_at = self._now_iso()

        if not viewer_id:
            return RecommendationQueryOutput(
                viewerId="",
                generatedAt=generated_at,
                source="empty",
                scoreVersion=QUERY_SCORE_VERSION,
                candidateCount=0,
                candidates=[],
                nextCursor=None,
                hasNextPage=False,
            )

        if self.cache is not None:
            cached_response = self.cache.get(request)
            if cached_response is not None:
                return cached_response

        viewer_row = self.repository.get_profile_embedding(viewer_id)
        viewer_profile_text = (
            request.viewerProfileText
            if isinstance(request.viewerProfileText, str)
            and request.viewerProfileText.strip()
            else (viewer_row or {}).get("semanticProfileText")
        )

        limit = max(1, int(request.limit))
        cursor = self._decode_cursor(request.cursor)
        cursor_source = str(cursor.get("source") or "").strip()
        cursor_offset = max(0, int(cursor.get("offset") or 0))
        page_span = max(limit * 3, settings.RECOMMENDATION_QUERY_RERANK_TOP_K)

        if cursor_source in ("", "semantic_online"):
            primary_batch = self.candidate_retrieval_service.get_semantic_online_batch(
                viewer_id,
                cursor_offset,
                page_span,
            )
            if not primary_batch.candidates:
                primary_batch = None
        else:
            primary_batch = None

        if primary_batch is None:
            (
                fallback_candidates,
                fallback_has_next,
            ) = self.global_fallback_service.get_batch(
                viewer_id=viewer_id,
                offset=cursor_offset,
                size=limit,
                excluded_candidate_ids=set(),
            )
            return self._build_response(
                viewer_id=viewer_id,
                generated_at=generated_at,
                source="global_fallback",
                score_version=QUERY_SCORE_VERSION,
                candidates=fallback_candidates,
                limit=limit,
                has_next=fallback_has_next,
                next_source="global_fallback",
                next_offset=cursor_offset + len(fallback_candidates),
                viewer_profile_text=viewer_profile_text,
                cache_request=request,
            )

        filtered_primary = self.candidate_retrieval_service.filter_graph_projection(
            viewer_id,
            primary_batch.candidates,
        )

        scored_primary = self._rerank_and_rank(
            viewer_id,
            viewer_profile_text,
            filtered_primary,
        )

        response_source = primary_batch.source
        response_candidates = scored_primary[:limit]
        has_next = primary_batch.has_next or len(scored_primary) > limit
        next_source = primary_batch.source
        next_offset = cursor_offset + len(response_candidates)

        if (
            len(response_candidates) < limit
            and primary_batch.source == "semantic_online"
        ):
            excluded_ids = {
                str(candidate["candidateId"]) for candidate in filtered_primary
            }
            (
                fallback_candidates,
                fallback_has_next,
            ) = self.global_fallback_service.get_batch(
                viewer_id=viewer_id,
                offset=0,
                size=limit - len(response_candidates),
                excluded_candidate_ids=excluded_ids,
            )
            response_candidates.extend(
                self._rank_with_passthrough_scores(
                    fallback_candidates,
                    start_rank=len(response_candidates) + 1,
                )
            )
            if fallback_candidates:
                response_source = "hybrid"
                next_source = "global_fallback"
                next_offset = len(fallback_candidates)
                has_next = has_next or fallback_has_next

        response = self._build_output(
            viewer_id=viewer_id,
            generated_at=generated_at,
            source=response_source,
            score_version=QUERY_SCORE_VERSION,
            candidates=response_candidates,
            has_next=has_next,
            next_cursor=self._encode_cursor(next_source, next_offset)
            if has_next
            else None,
        )
        if self.cache is not None:
            return self.cache.set(request, response)
        return response

    def _build_response(
        self,
        viewer_id: str,
        generated_at: str,
        source: str,
        score_version: str,
        candidates: list[dict[str, Any]],
        limit: int,
        has_next: bool,
        next_source: str,
        next_offset: int,
        viewer_profile_text: str | None,
        cache_request: RecommendationQueryRequest | None = None,
    ) -> RecommendationQueryOutput:
        scored = self._rerank_and_rank(viewer_id, viewer_profile_text, candidates)
        selected = scored[:limit]
        response = self._build_output(
            viewer_id=viewer_id,
            generated_at=generated_at,
            source=source,
            score_version=score_version,
            candidates=selected,
            has_next=has_next or len(scored) > limit,
            next_cursor=self._encode_cursor(next_source, next_offset)
            if (has_next or len(scored) > limit)
            else None,
        )
        if self.cache is not None and cache_request is not None:
            return self.cache.set(cache_request, response)
        return response

    def _build_output(
        self,
        viewer_id: str,
        generated_at: str,
        source: str,
        score_version: str,
        candidates: list[dict[str, Any]],
        has_next: bool,
        next_cursor: str | None,
    ) -> RecommendationQueryOutput:
        return RecommendationQueryOutput(
            viewerId=viewer_id,
            generatedAt=generated_at,
            source=source,
            scoreVersion=score_version,
            candidateCount=len(candidates),
            nextCursor=next_cursor,
            hasNextPage=has_next,
            candidates=[
                {
                    "candidateId": str(candidate["candidateId"]),
                    "source": str(candidate.get("source") or source),
                    "retrievalScore": float(candidate.get("retrievalScore", 0.0)),
                    "modelScore": float(candidate.get("modelScore", 0.0)),
                    "finalScore": float(candidate.get("finalScore", 0.0)),
                    "mutualFriendCount": int(
                        candidate.get("mutualFriendCount", 0)
                    ),
                    "commonGroupCount": int(candidate.get("commonGroupCount", 0)),
                    "scoreVersion": score_version,
                    "reasonCodes": list(candidate.get("reasonCodes", [])),
                    "rank": int(candidate.get("rank", index + 1)),
                }
                for index, candidate in enumerate(candidates)
            ],
        )

    def _rerank_and_rank(
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
        rerank_input = candidates[: settings.RECOMMENDATION_QUERY_RERANK_TOP_K]
        model_scores = self._resolve_model_scores(
            viewer_id,
            viewer_profile_text,
            rerank_input,
            pair_features,
        )

        scored = [
            {
                **candidate,
                "modelScore": model_scores.get(str(candidate["candidateId"]), 0.0),
                "mutualFriendCount": int(
                    pair_features.get(str(candidate["candidateId"]), {}).get(
                        "mutualFriendCount", 0
                    )
                ),
                "commonGroupCount": int(
                    pair_features.get(str(candidate["candidateId"]), {}).get(
                        "commonGroupCount", 0
                    )
                ),
                "finalScore": self._resolve_final_score(
                    float(candidate.get("retrievalScore", 0.0)),
                    model_scores.get(str(candidate["candidateId"]), 0.0),
                    self._resolve_graph_score(
                        pair_features.get(str(candidate["candidateId"]))
                    ),
                ),
                "reasonCodes": self._build_reason_codes(
                    model_scores.get(str(candidate["candidateId"]), 0.0),
                    pair_features.get(str(candidate["candidateId"])),
                ),
            }
            for candidate in candidates
        ]
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

    def _rank_with_passthrough_scores(
        self,
        candidates: list[dict[str, Any]],
        start_rank: int,
    ) -> list[dict[str, Any]]:
        ranked = []
        for index, candidate in enumerate(candidates):
            ranked.append(
                {
                    **candidate,
                    "modelScore": float(candidate.get("modelScore", 0.0)),
                    "finalScore": float(candidate.get("retrievalScore", 0.0)),
                    "reasonCodes": ["global_fallback"],
                    "rank": start_rank + index,
                }
            )
        return ranked

    def _resolve_model_scores(
        self,
        viewer_id: str,
        viewer_profile_text: str | None,
        candidates: list[dict[str, Any]],
        pair_features: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, float]:
        if not candidates:
            return {}

        resolved_pair_features = pair_features or {}
        scores = self.rerank_service.rerank(
            RecommendationRerankRequest(
                viewerId=viewer_id,
                viewerProfileText=viewer_profile_text,
                candidates=[
                    RecommendationCandidateInput(
                        candidateId=str(candidate["candidateId"]),
                        candidateProfileText=candidate.get("candidateProfileText"),
                        mutualFriends=int(
                            resolved_pair_features.get(
                                str(candidate["candidateId"]), {}
                            ).get("mutualFriendCount", 0)
                        ),
                        commonGroups=int(
                            resolved_pair_features.get(
                                str(candidate["candidateId"]), {}
                            ).get("commonGroupCount", 0)
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
        graph_score: float = 0.0,
    ) -> float:
        total_weight = (
            settings.RECOMMENDATION_QUERY_MODEL_WEIGHT
            + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
            + settings.RECOMMENDATION_QUERY_GRAPH_WEIGHT
        )
        return round(
            (
                settings.RECOMMENDATION_QUERY_MODEL_WEIGHT
                * self._clamp_score(model_score)
                + settings.RECOMMENDATION_QUERY_RETRIEVAL_WEIGHT
                * self._clamp_score(retrieval_score)
                + settings.RECOMMENDATION_QUERY_GRAPH_WEIGHT
                * self._clamp_score(graph_score)
            )
            / total_weight,
            6,
        )

    def _resolve_graph_score(self, pair_feature: dict[str, Any] | None) -> float:
        if not pair_feature:
            return 0.0

        mutual_friend_score = min(
            int(pair_feature.get("mutualFriendCount", 0)),
            settings.RECOMMENDATION_MUTUAL_FRIEND_CAP,
        ) / settings.RECOMMENDATION_MUTUAL_FRIEND_CAP
        common_group_score = min(
            int(pair_feature.get("commonGroupCount", 0)),
            settings.RECOMMENDATION_COMMON_GROUP_CAP,
        ) / settings.RECOMMENDATION_COMMON_GROUP_CAP

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
        if float(model_score) > 0:
            reasons.append("semantic_rerank")

        if pair_feature:
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

    def _decode_cursor(self, cursor: str | None) -> dict[str, Any]:
        if not cursor:
            return {}

        try:
            decoded = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
            payload = json.loads(decoded)
            if not isinstance(payload, dict):
                return {}
            return payload
        except Exception:
            return {}

    def _encode_cursor(self, source: str, offset: int) -> str:
        payload = json.dumps(
            {
                "source": str(source),
                "offset": max(0, int(offset)),
            },
            separators=(",", ":"),
        )
        return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")

    def _clamp_score(self, value: float | None) -> float:
        if value is None:
            return 0.0
        return max(0.0, min(1.0, float(value)))

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
