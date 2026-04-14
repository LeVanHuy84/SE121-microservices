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
from app.services.query_cache import RecommendationQueryCache
from app.services.query_service import QueryService


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
                cache = RecommendationQueryCache(ttl_seconds=30, max_entries=10)
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


if __name__ == "__main__":
    unittest.main()
