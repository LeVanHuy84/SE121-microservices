import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.models.rerank_request import (
    RecommendationCandidateScore,
    RecommendationQueryRequest,
)
from app.services.query_cache import (
    RedisRecommendationQueryCache,
)
from app.services.query_service import QueryService


class FakeRedisPipeline:
    def __init__(self, client):
        self.client = client

    def set(self, *args, **kwargs):
        self.client.set(*args, **kwargs)
        return self

    def sadd(self, *args, **kwargs):
        self.client.sadd(*args, **kwargs)
        return self

    def pexpire(self, *args, **kwargs):
        self.client.pexpire(*args, **kwargs)
        return self

    def zadd(self, *args, **kwargs):
        self.client.zadd(*args, **kwargs)
        return self

    def hincrby(self, *args, **kwargs):
        self.client.hincrby(*args, **kwargs)
        return self

    def delete(self, *args, **kwargs):
        self.client.delete(*args, **kwargs)
        return self

    def zrem(self, *args, **kwargs):
        self.client.zrem(*args, **kwargs)
        return self

    def execute(self):
        return []


class FakeRedis:
    def __init__(self):
        self.values = {}
        self.sets = {}
        self.zsets = {}
        self.hashes = {}

    def pipeline(self):
        return FakeRedisPipeline(self)

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, px=None):
        self.values[key] = value
        return True

    def sadd(self, key, value):
        self.sets.setdefault(key, set()).add(value)
        return 1

    def pexpire(self, key, ttl_ms):
        return True

    def zadd(self, key, mapping):
        self.zsets.setdefault(key, {}).update(mapping)
        return len(mapping)

    def zrem(self, key, value):
        self.zsets.setdefault(key, {}).pop(value, None)
        return 1

    def zcard(self, key):
        return len(self.zsets.get(key, {}))

    def zrange(self, key, start, stop):
        items = sorted(self.zsets.get(key, {}).items(), key=lambda item: item[1])
        if stop == -1:
            return [item[0] for item in items[start:]]
        return [item[0] for item in items[start : stop + 1]]

    def smembers(self, key):
        return set(self.sets.get(key, set()))

    def delete(self, *keys):
        deleted = 0
        for key in keys:
            deleted += int(key in self.values or key in self.sets or key in self.hashes)
            self.values.pop(key, None)
            self.sets.pop(key, None)
            self.hashes.pop(key, None)
            self.zsets.pop(key, None)
        return deleted

    def hincrby(self, key, field, amount):
        self.hashes.setdefault(key, {})
        self.hashes[key][field] = int(self.hashes[key].get(field, 0)) + int(amount)
        return self.hashes[key][field]

    def hgetall(self, key):
        return dict(self.hashes.get(key, {}))

    def scan_iter(self, pattern):
        prefix = pattern.removesuffix("*")
        keys = set(self.values) | set(self.sets) | set(self.hashes) | set(self.zsets)
        return (key for key in keys if key.startswith(prefix))


class RecommendationQueryServiceTestCase(unittest.TestCase):
    def test_query_uses_global_fallback_for_cold_start(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.replace_global_fallback_candidates(
                    [
                        {
                            "candidateId": "candidate-1",
                            "fallbackScore": 0.91,
                            "rank": 1,
                        }
                    ],
                    datetime.now(timezone.utc).isoformat(),
                    "global-fallback-v1",
                )
                rerank_service = Mock()
                rerank_service.rerank.return_value = []
                service = QueryService(repository, rerank_service, cache=None)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-1", limit=1)
                )

                self.assertEqual(response.source, "global_fallback")
                self.assertEqual(response.candidateCount, 1)
                self.assertEqual(response.candidates[0].candidateId, "candidate-1")
                rerank_service.rerank.assert_called_once()
            finally:
                repository.close()

    def test_query_prefers_semantic_online_over_global_fallback(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "viewer-1",
                    "name: Viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-online",
                    "name: Online Candidate",
                    [0.95, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.replace_global_fallback_candidates(
                    [
                        {
                            "candidateId": "candidate-fallback",
                            "fallbackScore": 0.99,
                            "rank": 1,
                        }
                    ],
                    datetime.now(timezone.utc).isoformat(),
                    "global-fallback-v1",
                )
                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-online",
                        modelScore=0.8,
                        reason="strong",
                    )
                ]
                service = QueryService(repository, rerank_service, cache=None)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-1", limit=1)
                )

                self.assertEqual(response.source, "semantic_online")
                self.assertEqual(response.candidateCount, 1)
                self.assertEqual(response.candidates[0].candidateId, "candidate-online")
            finally:
                repository.close()

    def test_query_falls_back_to_semantic_online_rerank(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "viewer-1",
                    "name: Viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-a",
                    "name: Candidate A",
                    [0.9, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-b",
                    "name: Candidate B",
                    [0.8, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-a",
                        modelScore=0.1,
                        reason="weak",
                    ),
                    RecommendationCandidateScore(
                        candidateId="candidate-b",
                        modelScore=0.9,
                        reason="strong",
                    ),
                ]
                service = QueryService(repository, rerank_service, cache=None)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-1", limit=2)
                )

                self.assertEqual(response.source, "semantic_online")
                self.assertEqual(
                    [candidate.candidateId for candidate in response.candidates],
                    ["candidate-b", "candidate-a"],
                )
                self.assertEqual(
                    response.candidates[0].reasonCodes,
                    ["semantic_retrieval", "semantic_rerank"],
                )
                rerank_service.rerank.assert_called_once()
            finally:
                repository.close()

    def test_query_appends_graph_pair_feature_reason_codes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "viewer-2",
                    "name: Viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-z",
                    "name: Candidate Z",
                    [0.88, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_graph_pair_feature(
                    "viewer-2",
                    "candidate-z",
                    mutual_friend_count=0,
                    common_group_count=1,
                    last_event_type="recommendation.graph.user-unblocked",
                    last_event_at=datetime.now(timezone.utc),
                )
                repository.apply_graph_friend_request_accepted(
                    "viewer-2",
                    "mutual-z",
                )
                repository.apply_graph_friend_request_accepted(
                    "candidate-z",
                    "mutual-z",
                )

                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-z",
                        modelScore=0.7,
                        reason="strong",
                    )
                ]
                service = QueryService(repository, rerank_service, cache=None)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-2", limit=5)
                )

                self.assertEqual(response.candidateCount, 1)
                self.assertEqual(
                    response.candidates[0].reasonCodes,
                    [
                        "semantic_retrieval",
                        "semantic_rerank",
                        "graph_mutual_friend",
                        "graph_common_group",
                        "graph_rerank",
                        "graph_recent_unblock",
                    ],
                )
            finally:
                repository.close()

    def test_query_graph_score_can_lift_candidate_rank(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "viewer-1",
                    "name: Viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-semantic",
                    "name: Semantic",
                    [0.9, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-graph",
                    "name: Graph",
                    [0.89, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.apply_graph_friend_request_accepted(
                    "viewer-1",
                    "mutual-friend",
                )
                repository.apply_graph_friend_request_accepted(
                    "candidate-graph",
                    "mutual-friend",
                )

                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-semantic",
                        modelScore=0.5,
                        reason="semantic",
                    ),
                    RecommendationCandidateScore(
                        candidateId="candidate-graph",
                        modelScore=0.5,
                        reason="graph",
                    ),
                ]
                service = QueryService(repository, rerank_service, cache=None)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-1", limit=2)
                )

                self.assertEqual(
                    [candidate.candidateId for candidate in response.candidates],
                    ["candidate-graph", "candidate-semantic"],
                )
                self.assertEqual(response.candidates[0].mutualFriendCount, 1)
                self.assertIn("graph_rerank", response.candidates[0].reasonCodes)
            finally:
                repository.close()

    def test_query_uses_cache_until_viewer_is_invalidated(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.upsert_profile_embedding(
                    "viewer-cache",
                    "name: Viewer",
                    [1.0, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                repository.upsert_profile_embedding(
                    "candidate-cache",
                    "name: Candidate",
                    [0.9, 0.0],
                    "demo-model",
                    "2026-04-13T00:00:00+00:00",
                )
                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-cache",
                        modelScore=0.8,
                        reason="strong",
                    )
                ]
                cache = RedisRecommendationQueryCache(
                    redis_host="localhost",
                    redis_port=6379,
                    redis_db=0,
                    ttl_seconds=30,
                    max_entries=10,
                    key_prefix="test:recommendation-cache",
                    client=FakeRedis(),
                )
                service = QueryService(repository, rerank_service, cache=cache)
                request = RecommendationQueryRequest(
                    viewerId="viewer-cache",
                    limit=5,
                )

                first_response = service.query(request)
                second_response = service.query(request)

                self.assertEqual(first_response.candidateCount, 1)
                self.assertEqual(second_response.candidateCount, 1)
                rerank_service.rerank.assert_called_once()

                cache.invalidate_viewer("viewer-cache")
                service.query(request)

                self.assertEqual(rerank_service.rerank.call_count, 2)
            finally:
                repository.close()

    def test_redis_query_cache_round_trips_and_invalidates_viewer(self):
        redis = FakeRedis()
        cache = RedisRecommendationQueryCache(
            redis_host="localhost",
            redis_port=6379,
            redis_db=0,
            ttl_seconds=30,
            max_entries=10,
            key_prefix="test:recommendation-cache",
            client=redis,
        )
        request = RecommendationQueryRequest(viewerId="viewer-redis", limit=5)
        output = QueryService(
            Mock(),
            Mock(),
            cache=None,
        )._build_output(
            viewer_id="viewer-redis",
            generated_at="2026-04-13T00:00:00+00:00",
            source="global_fallback",
            score_version="recommendation-query-pipeline-v1",
            candidates=[
                {
                    "candidateId": "candidate-redis",
                    "source": "global_fallback",
                    "retrievalScore": 0.7,
                    "modelScore": 0.0,
                    "finalScore": 0.7,
                    "rank": 1,
                    "reasonCodes": ["global_fallback"],
                }
            ],
            has_next=False,
            next_cursor=None,
        )

        self.assertIsNone(cache.get(request))
        cache.set(request, output)
        cached_output = cache.get(request)

        self.assertIsNotNone(cached_output)
        self.assertEqual(cached_output.viewerId, "viewer-redis")
        self.assertEqual(cached_output.candidates[0].candidateId, "candidate-redis")
        stats_after_hit = cache.get_stats()
        self.assertEqual(stats_after_hit["backend"], "redis")
        self.assertEqual(stats_after_hit["misses"], 1)
        self.assertEqual(stats_after_hit["hits"], 1)
        self.assertEqual(stats_after_hit["sets"], 1)

        cache.invalidate_viewer("viewer-redis")

        self.assertIsNone(cache.get(request))
        stats_after_invalidation = cache.get_stats()
        self.assertEqual(stats_after_invalidation["invalidations"], 1)

    def test_redis_query_cache_evicts_over_limit(self):
        redis = FakeRedis()
        cache = RedisRecommendationQueryCache(
            redis_host="localhost",
            redis_port=6379,
            redis_db=0,
            ttl_seconds=30,
            max_entries=1,
            key_prefix="test:recommendation-cache",
            client=redis,
        )
        service = QueryService(Mock(), Mock(), cache=None)
        first_request = RecommendationQueryRequest(viewerId="viewer-1", limit=5)
        second_request = RecommendationQueryRequest(viewerId="viewer-2", limit=5)
        first_output = service._build_output(
            viewer_id="viewer-1",
            generated_at="2026-04-13T00:00:00+00:00",
            source="global_fallback",
            score_version="recommendation-query-pipeline-v1",
            candidates=[],
            has_next=False,
            next_cursor=None,
        )
        second_output = first_output.model_copy(update={"viewerId": "viewer-2"})

        cache.set(first_request, first_output)
        cache.set(second_request, second_output)

        self.assertIsNone(cache.get(first_request))
        self.assertEqual(cache.get(second_request).viewerId, "viewer-2")
        stats = cache.get_stats()
        self.assertEqual(stats["evictions"], 1)
        self.assertEqual(stats["entryCount"], 1)


if __name__ == "__main__":
    unittest.main()
