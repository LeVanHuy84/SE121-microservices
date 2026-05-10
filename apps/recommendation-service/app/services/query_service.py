from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.database.recommendation_state_repository import RecommendationStateRepository
from app.models.rerank_request import (
    RecommendationQueryOutput,
    RecommendationQueryRequest,
)
from app.services.candidate_retrieval_service import CandidateRetrievalService
from app.services.global_fallback_service import GlobalFallbackService
from app.services.query_cache import QueryCache, query_cache
from app.services.ranking_service import RankingService
from app.services.rerank_service import RerankService

QUERY_SCORE_VERSION = "recommendation-query-pipeline-v2"
SESSION_CURSOR_SOURCE = "semantic_session"


class QueryService:
    def __init__(
        self,
        repository: RecommendationStateRepository,
        rerank_service: RerankService,
        candidate_retrieval_service: CandidateRetrievalService | None = None,
        global_fallback_service: GlobalFallbackService | None = None,
        cache: QueryCache | None = query_cache,
        ranking_service: RankingService | None = None,
    ):
        self.repository = repository
        self.cache = cache
        self.candidate_retrieval_service = (
            candidate_retrieval_service or CandidateRetrievalService(repository)
        )
        self.global_fallback_service = (
            global_fallback_service or GlobalFallbackService(repository)
        )
        self.ranking_service = ranking_service or RankingService(
            repository=repository,
            rerank_service=rerank_service,
        )

    def query(self, request: RecommendationQueryRequest) -> RecommendationQueryOutput:
        viewer_id = str(request.viewerId or "").strip()
        generated_at = self._now_iso()

        if not viewer_id:
            return self._build_output(
                viewer_id="",
                generated_at=generated_at,
                source="empty",
                score_version=QUERY_SCORE_VERSION,
                candidates=[],
                has_next=False,
                next_cursor=None,
            )

        cached_response = self._get_cached_response(request)
        if cached_response is not None:
            return cached_response

        limit = max(1, int(request.limit))
        cursor = self._decode_cursor(request.cursor)
        cursor_source = str(cursor.get("source") or "").strip()
        cursor_offset = max(0, int(cursor.get("offset") or 0))

        if cursor_source == SESSION_CURSOR_SOURCE:
            session_response = self._build_session_response(
                request=request,
                viewer_id=viewer_id,
                generated_at=generated_at,
                cursor=cursor,
                limit=limit,
            )
            if session_response is not None:
                return session_response
            cursor_source = "semantic_online"

        viewer_profile_text = self._resolve_viewer_profile_text(request, viewer_id)
        window_size = self._resolve_session_window_size(limit)
        page_span = max(window_size, settings.RECOMMENDATION_QUERY_RERANK_TOP_K)

        primary_batch = None
        if cursor_source in ("", "semantic_online"):
            primary_batch = self.candidate_retrieval_service.get_semantic_online_batch(
                viewer_id,
                cursor_offset,
                page_span,
            )
            if not primary_batch.candidates:
                primary_batch = None

        if primary_batch is None:
            return self._build_fallback_only_response(
                request=request,
                viewer_id=viewer_id,
                generated_at=generated_at,
                viewer_profile_text=viewer_profile_text,
                offset=cursor_offset,
                limit=limit,
            )

        ranked_primary = self.ranking_service.rank_candidates(
            viewer_id=viewer_id,
            viewer_profile_text=viewer_profile_text,
            # CandidateRetrievalService already applies graph projection filtering.
            candidates=primary_batch.candidates,
        )

        session_candidates = list(ranked_primary)
        response_source = primary_batch.source
        session_source = primary_batch.source
        has_more_source = primary_batch.has_next

        if len(session_candidates) < window_size and primary_batch.source == "semantic_online":
            excluded_ids = {str(candidate["candidateId"]) for candidate in primary_batch.candidates}
            fallback_candidates, fallback_has_next = self.global_fallback_service.get_batch(
                viewer_id=viewer_id,
                offset=0,
                size=window_size - len(session_candidates),
                excluded_candidate_ids=excluded_ids,
            )
            ranked_fallback = self.ranking_service.passthrough_fallback_candidates(
                fallback_candidates,
                start_rank=len(session_candidates) + 1,
            )
            if ranked_fallback:
                session_candidates.extend(ranked_fallback)
                session_source = "hybrid"
                has_more_source = has_more_source or fallback_has_next

        response_candidates = session_candidates[:limit]
        if any(str(candidate.get("source") or "") == "global_fallback" for candidate in response_candidates):
            response_source = "hybrid"

        has_next = len(session_candidates) > limit or has_more_source
        next_cursor = self._build_next_cursor(
            viewer_id=viewer_id,
            session_source=session_source,
            candidates=session_candidates,
            current_page_size=len(response_candidates),
            fallback_source=primary_batch.source,
            fallback_offset=cursor_offset + min(limit, len(session_candidates)),
            has_next=has_next,
        )

        response = self._build_output(
            viewer_id=viewer_id,
            generated_at=generated_at,
            source=response_source,
            score_version=QUERY_SCORE_VERSION,
            candidates=response_candidates,
            has_next=has_next,
            next_cursor=next_cursor,
        )
        return self._cache_response(request, response)

    def _build_fallback_only_response(
        self,
        request: RecommendationQueryRequest,
        viewer_id: str,
        generated_at: str,
        viewer_profile_text: str | None,
        offset: int,
        limit: int,
    ) -> RecommendationQueryOutput:
        fallback_candidates, fallback_has_next = self.global_fallback_service.get_batch(
            viewer_id=viewer_id,
            offset=offset,
            size=limit,
            excluded_candidate_ids=set(),
        )

        ranked = self.ranking_service.rank_candidates(
            viewer_id=viewer_id,
            viewer_profile_text=viewer_profile_text,
            candidates=fallback_candidates,
        )

        response = self._build_output(
            viewer_id=viewer_id,
            generated_at=generated_at,
            source="global_fallback",
            score_version=QUERY_SCORE_VERSION,
            candidates=ranked[:limit],
            has_next=fallback_has_next or len(ranked) > limit,
            next_cursor=self._encode_cursor("global_fallback", offset + len(ranked))
            if (fallback_has_next or len(ranked) > limit)
            else None,
        )
        return self._cache_response(request, response)

    def _resolve_viewer_profile_text(
        self,
        request: RecommendationQueryRequest,
        viewer_id: str,
    ) -> str | None:
        if isinstance(request.viewerProfileText, str) and request.viewerProfileText.strip():
            return request.viewerProfileText

        viewer_row = self.repository.get_profile_embedding(viewer_id)
        return (viewer_row or {}).get("semanticProfileText")

    def _build_next_cursor(
        self,
        viewer_id: str,
        session_source: str,
        candidates: list[dict[str, Any]],
        current_page_size: int,
        fallback_source: str,
        fallback_offset: int,
        has_next: bool,
    ) -> str | None:
        if not has_next:
            return None

        # Only issue a session cursor when the in-memory session has data
        # beyond the current page. Otherwise a session cursor can "stall"
        # at the same offset and should fallback to source+offset cursor.
        if (
            self.cache is not None
            and candidates
            and len(candidates) > current_page_size
        ):
            session_id = self.cache.store_candidate_session(
                viewer_id=viewer_id,
                source=session_source,
                score_version=QUERY_SCORE_VERSION,
                candidates=candidates,
            )
            if session_id:
                return self._encode_session_cursor(session_id, current_page_size)

        return self._encode_cursor(fallback_source, fallback_offset)

    def _get_cached_response(
        self,
        request: RecommendationQueryRequest,
    ) -> RecommendationQueryOutput | None:
        if self.cache is None:
            return None
        return self.cache.get(request)

    def _cache_response(
        self,
        request: RecommendationQueryRequest,
        response: RecommendationQueryOutput,
    ) -> RecommendationQueryOutput:
        if self.cache is None:
            return response
        return self.cache.set(request, response)

    def _build_session_response(
        self,
        request: RecommendationQueryRequest,
        viewer_id: str,
        generated_at: str,
        cursor: dict[str, Any],
        limit: int,
    ) -> RecommendationQueryOutput | None:
        if self.cache is None:
            return None

        session_id = str(cursor.get("sessionId") or "").strip()
        if not session_id:
            return None

        session = self.cache.get_candidate_session(session_id)
        if not session or str(session.get("viewerId") or "").strip() != viewer_id:
            return None

        candidates = session.get("candidates")
        if not isinstance(candidates, list):
            return None

        offset = max(0, int(cursor.get("offset") or 0))
        selected = [
            candidate
            for candidate in candidates[offset : offset + limit]
            if isinstance(candidate, dict)
        ]
        next_offset = offset + len(selected)
        has_next = next_offset < len(candidates)

        response = self._build_output(
            viewer_id=viewer_id,
            generated_at=generated_at,
            source=str(session.get("source") or "semantic_online"),
            score_version=str(session.get("scoreVersion") or QUERY_SCORE_VERSION),
            candidates=selected,
            has_next=has_next,
            next_cursor=self._encode_session_cursor(session_id, next_offset)
            if has_next
            else None,
        )
        return self._cache_response(request, response)

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
                    "mutualFriendCount": int(candidate.get("mutualFriendCount", 0)),
                    "commonGroupCount": int(candidate.get("commonGroupCount", 0)),
                    "scoreVersion": score_version,
                    "reasonCodes": list(candidate.get("reasonCodes", [])),
                    "rank": int(candidate.get("rank", index + 1)),
                }
                for index, candidate in enumerate(candidates)
            ],
        )

    def _resolve_session_window_size(self, limit: int) -> int:
        safe_limit = max(1, int(limit))
        configured_window = max(
            safe_limit,
            int(settings.RECOMMENDATION_QUERY_SESSION_WINDOW_SIZE),
        )
        # Keep first-page ranking window bounded to reduce latency spikes.
        target_window = max(
            safe_limit * 3,
            int(settings.RECOMMENDATION_QUERY_RERANK_TOP_K),
        )
        return min(configured_window, target_window)

    def _decode_cursor(self, cursor: str | None) -> dict[str, Any]:
        if not cursor:
            return {}

        try:
            decoded = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
            payload = json.loads(decoded)
            if not isinstance(payload, dict):
                raise ValueError("Invalid cursor payload format")

            source = str(payload.get("source") or "").strip()
            offset = payload.get("offset")
            session_id = str(payload.get("sessionId") or "").strip()
            if not isinstance(offset, int) or offset < 0:
                raise ValueError("Invalid cursor offset")

            if source == SESSION_CURSOR_SOURCE:
                if not session_id:
                    raise ValueError("Missing cursor sessionId")
                return {
                    "source": SESSION_CURSOR_SOURCE,
                    "sessionId": session_id,
                    "offset": offset,
                }

            if source not in {"semantic_online", "global_fallback"}:
                raise ValueError("Unsupported cursor source")
            return {
                "source": source,
                "offset": offset,
            }
        except Exception:
            raise ValueError("Invalid cursor")

    def _encode_cursor(self, source: str, offset: int) -> str:
        payload = json.dumps(
            {
                "source": str(source),
                "offset": max(0, int(offset)),
            },
            separators=(",", ":"),
        )
        return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")

    def _encode_session_cursor(self, session_id: str, offset: int) -> str:
        payload = json.dumps(
            {
                "source": SESSION_CURSOR_SOURCE,
                "sessionId": str(session_id),
                "offset": max(0, int(offset)),
            },
            separators=(",", ":"),
        )
        return base64.urlsafe_b64encode(payload.encode("utf-8")).decode("utf-8")

    def _now_iso(self) -> str:
        return datetime.now(timezone.utc).isoformat()
