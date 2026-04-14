from __future__ import annotations

from collections import OrderedDict, defaultdict
from threading import RLock
from time import monotonic

from app.core.config import settings
from app.models.rerank_request import (
    RecommendationQueryOutput,
    RecommendationQueryRequest,
)

CacheKey = tuple[str, int, str, str]


class RecommendationQueryCache:
    def __init__(self, ttl_seconds: float, max_entries: int):
        self.ttl_seconds = max(0.0, float(ttl_seconds))
        self.max_entries = max(1, int(max_entries))
        self._entries: OrderedDict[
            CacheKey, tuple[float, RecommendationQueryOutput]
        ] = OrderedDict()
        self._viewer_keys: dict[str, set[CacheKey]] = defaultdict(set)
        self._lock = RLock()

    def get(
        self,
        request: RecommendationQueryRequest,
    ) -> RecommendationQueryOutput | None:
        if self.ttl_seconds <= 0:
            return None

        key = self._make_key(request)
        now = monotonic()
        with self._lock:
            cached = self._entries.get(key)
            if cached is None:
                return None

            expires_at, output = cached
            if expires_at <= now:
                self._delete_key(key)
                return None

            self._entries.move_to_end(key)
            return self._clone_output(output)

    def set(
        self,
        request: RecommendationQueryRequest,
        output: RecommendationQueryOutput,
    ) -> RecommendationQueryOutput:
        if self.ttl_seconds <= 0:
            return output

        key = self._make_key(request)
        viewer_id = key[0]
        with self._lock:
            self._entries[key] = (
                monotonic() + self.ttl_seconds,
                self._clone_output(output),
            )
            self._entries.move_to_end(key)
            self._viewer_keys[viewer_id].add(key)
            self._evict_over_limit()

        return output

    def invalidate_viewer(self, viewer_id: str):
        normalized_viewer_id = str(viewer_id or "").strip()
        if not normalized_viewer_id:
            return

        with self._lock:
            keys = set(self._viewer_keys.pop(normalized_viewer_id, set()))
            for key in keys:
                self._entries.pop(key, None)

    def invalidate_many(self, viewer_ids: list[str] | tuple[str, ...] | set[str]):
        for viewer_id in viewer_ids:
            self.invalidate_viewer(viewer_id)

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._viewer_keys.clear()

    def _evict_over_limit(self):
        while len(self._entries) > self.max_entries:
            oldest_key, _ = self._entries.popitem(last=False)
            self._viewer_keys[oldest_key[0]].discard(oldest_key)
            if not self._viewer_keys[oldest_key[0]]:
                self._viewer_keys.pop(oldest_key[0], None)

    def _delete_key(self, key: CacheKey):
        self._entries.pop(key, None)
        self._viewer_keys[key[0]].discard(key)
        if not self._viewer_keys[key[0]]:
            self._viewer_keys.pop(key[0], None)

    def _make_key(self, request: RecommendationQueryRequest) -> CacheKey:
        return (
            str(request.viewerId or "").strip(),
            int(request.limit),
            str(request.cursor or ""),
            str(request.viewerProfileText or "").strip(),
        )

    def _clone_output(
        self,
        output: RecommendationQueryOutput,
    ) -> RecommendationQueryOutput:
        return output.model_copy(deep=True)


query_cache = RecommendationQueryCache(
    settings.RECOMMENDATION_QUERY_CACHE_TTL_SECONDS,
    settings.RECOMMENDATION_QUERY_CACHE_MAX_ENTRIES,
)
