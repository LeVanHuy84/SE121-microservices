from __future__ import annotations

import hashlib
import json
import logging
from time import monotonic
from typing import Any, Protocol

from app.core.config import settings
from app.models.rerank_request import (
    RecommendationQueryOutput,
    RecommendationQueryRequest,
)

logger = logging.getLogger(__name__)


class QueryCache(Protocol):
    def get(
        self,
        request: RecommendationQueryRequest,
    ) -> RecommendationQueryOutput | None: ...

    def set(
        self,
        request: RecommendationQueryRequest,
        output: RecommendationQueryOutput,
    ) -> RecommendationQueryOutput: ...

    def invalidate_viewer(self, viewer_id: str): ...

    def invalidate_many(self, viewer_ids: list[str] | tuple[str, ...] | set[str]): ...

    def clear(self): ...

    def get_stats(self) -> dict[str, int | float | str | bool]: ...


class RedisRecommendationQueryCache:
    def __init__(
        self,
        redis_host: str,
        redis_port: int,
        redis_db: int,
        ttl_seconds: float,
        max_entries: int,
        key_prefix: str,
        client: Any | None = None,
    ):
        self.redis_host = str(redis_host or "").strip()
        self.redis_port = int(redis_port)
        self.redis_db = int(redis_db)
        self.ttl_seconds = max(0.0, float(ttl_seconds))
        self.max_entries = max(1, int(max_entries))
        self.key_prefix = str(key_prefix or "recommendation:query-cache").strip()
        self._ttl_ms = max(1, int(self.ttl_seconds * 1000))
        self._client = client or self._create_client()
        self._unavailable_until = 0.0

    def get(
        self,
        request: RecommendationQueryRequest,
    ) -> RecommendationQueryOutput | None:
        if self.ttl_seconds <= 0:
            self._increment_stat("misses")
            return None
        if self._is_unavailable():
            return None

        cache_key = self._make_entry_key(request)
        try:
            payload = self._client.get(cache_key)
            if payload is None:
                self._increment_stat("misses")
                self._client.zrem(self._index_key, cache_key)
                return None

            self._client.zadd(self._index_key, {cache_key: monotonic()})
            self._increment_stat("hits")
            return RecommendationQueryOutput.model_validate_json(payload)
        except Exception as exc:
            logger.warning("Redis recommendation query cache get failed: %s", exc)
            self._mark_unavailable()
            return None

    def set(
        self,
        request: RecommendationQueryRequest,
        output: RecommendationQueryOutput,
    ) -> RecommendationQueryOutput:
        if self.ttl_seconds <= 0:
            return output
        if self._is_unavailable():
            return output

        cache_key = self._make_entry_key(request)
        viewer_key = self._viewer_key(str(request.viewerId or "").strip())
        try:
            payload = output.model_dump_json()
            pipe = self._client.pipeline()
            pipe.set(cache_key, payload, px=self._ttl_ms)
            pipe.sadd(viewer_key, cache_key)
            pipe.pexpire(viewer_key, self._ttl_ms)
            pipe.zadd(self._index_key, {cache_key: monotonic()})
            pipe.hincrby(self._stats_key, "sets", 1)
            pipe.execute()
            self._evict_over_limit()
        except Exception as exc:
            logger.warning("Redis recommendation query cache set failed: %s", exc)
            self._mark_unavailable()

        return output

    def invalidate_viewer(self, viewer_id: str):
        normalized_viewer_id = str(viewer_id or "").strip()
        if not normalized_viewer_id:
            return
        if self._is_unavailable():
            return

        viewer_key = self._viewer_key(normalized_viewer_id)
        try:
            keys = list(self._client.smembers(viewer_key) or [])
            if not keys:
                return

            pipe = self._client.pipeline()
            for key in keys:
                pipe.delete(key)
                pipe.zrem(self._index_key, key)
            pipe.delete(viewer_key)
            pipe.hincrby(self._stats_key, "invalidations", 1)
            pipe.execute()
        except Exception as exc:
            logger.warning(
                "Redis recommendation query cache viewer invalidation failed: %s",
                exc,
            )
            self._mark_unavailable()

    def invalidate_many(self, viewer_ids: list[str] | tuple[str, ...] | set[str]):
        for viewer_id in viewer_ids:
            self.invalidate_viewer(viewer_id)

    def clear(self):
        if self._is_unavailable():
            return

        try:
            keys = list(self._client.scan_iter(f"{self.key_prefix}:*"))
            if keys:
                self._client.delete(*keys)
            self._increment_stat("clears")
        except Exception as exc:
            logger.warning("Redis recommendation query cache clear failed: %s", exc)
            self._mark_unavailable()

    def get_stats(self) -> dict[str, int | float | str | bool]:
        if self._is_unavailable():
            return self._unavailable_stats()

        try:
            raw_stats = self._client.hgetall(self._stats_key)
            return {
                "backend": "redis",
                "available": True,
                "redisHost": self.redis_host,
                "redisPort": self.redis_port,
                "redisDb": self.redis_db,
                "keyPrefix": self.key_prefix,
                "ttlSeconds": self.ttl_seconds,
                "maxEntries": self.max_entries,
                "entryCount": int(self._client.zcard(self._index_key) or 0),
                "viewerCount": len(
                    list(self._client.scan_iter(f"{self.key_prefix}:viewer:*"))
                ),
                "hits": int(raw_stats.get("hits", 0)),
                "misses": int(raw_stats.get("misses", 0)),
                "sets": int(raw_stats.get("sets", 0)),
                "evictions": int(raw_stats.get("evictions", 0)),
                "invalidations": int(raw_stats.get("invalidations", 0)),
                "clears": int(raw_stats.get("clears", 0)),
                "errors": int(raw_stats.get("errors", 0)),
            }
        except Exception as exc:
            logger.warning("Redis recommendation query cache stats failed: %s", exc)
            self._mark_unavailable()
            return self._unavailable_stats()

    @property
    def _index_key(self) -> str:
        return f"{self.key_prefix}:index"

    @property
    def _stats_key(self) -> str:
        return f"{self.key_prefix}:stats"

    def _evict_over_limit(self):
        overflow = int(self._client.zcard(self._index_key) or 0) - self.max_entries
        if overflow <= 0:
            return

        keys = list(self._client.zrange(self._index_key, 0, overflow - 1) or [])
        if not keys:
            return

        pipe = self._client.pipeline()
        for key in keys:
            pipe.delete(key)
            pipe.zrem(self._index_key, key)
        pipe.hincrby(self._stats_key, "evictions", len(keys))
        pipe.execute()

    def _increment_stat(self, name: str, amount: int = 1):
        if self._is_unavailable():
            return

        try:
            self._client.hincrby(self._stats_key, name, amount)
        except Exception:
            logger.debug("Failed to increment Redis cache stat=%s", name)
            self._mark_unavailable()

    def _is_unavailable(self) -> bool:
        return monotonic() < self._unavailable_until

    def _mark_unavailable(self):
        self._unavailable_until = monotonic() + 5.0

    def _unavailable_stats(self) -> dict[str, int | float | str | bool]:
        return {
            "backend": "redis",
            "available": False,
            "redisHost": self.redis_host,
            "redisPort": self.redis_port,
            "redisDb": self.redis_db,
            "keyPrefix": self.key_prefix,
            "ttlSeconds": self.ttl_seconds,
            "maxEntries": self.max_entries,
            "entryCount": 0,
            "viewerCount": 0,
            "hits": 0,
            "misses": 0,
            "sets": 0,
            "evictions": 0,
            "invalidations": 0,
            "clears": 0,
            "errors": 1,
        }

    def _make_entry_key(self, request: RecommendationQueryRequest) -> str:
        payload = {
            "viewerId": str(request.viewerId or "").strip(),
            "limit": int(request.limit),
            "cursor": str(request.cursor or ""),
            "viewerProfileText": str(request.viewerProfileText or "").strip(),
        }
        digest = hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return f"{self.key_prefix}:entry:{digest}"

    def _viewer_key(self, viewer_id: str) -> str:
        digest = hashlib.sha256(viewer_id.encode("utf-8")).hexdigest()
        return f"{self.key_prefix}:viewer:{digest}"

    def _create_client(self):
        try:
            from redis import Redis
        except ImportError as exc:
            raise RuntimeError(
                "redis package is required for Redis recommendation query cache"
            ) from exc

        return Redis(
            host=self.redis_host,
            port=self.redis_port,
            db=self.redis_db,
            decode_responses=True,
            socket_connect_timeout=0.5,
            socket_timeout=0.5,
        )


query_cache = RedisRecommendationQueryCache(
    redis_host=settings.RECOMMENDATION_QUERY_CACHE_REDIS_HOST,
    redis_port=settings.RECOMMENDATION_QUERY_CACHE_REDIS_PORT,
    redis_db=settings.RECOMMENDATION_QUERY_CACHE_REDIS_DB,
    ttl_seconds=settings.RECOMMENDATION_QUERY_CACHE_TTL_SECONDS,
    max_entries=settings.RECOMMENDATION_QUERY_CACHE_MAX_ENTRIES,
    key_prefix=settings.RECOMMENDATION_QUERY_CACHE_REDIS_PREFIX,
)
