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
from app.services.query_service import QueryService


class RecommendationQueryServiceTestCase(unittest.TestCase):
    def test_query_prefers_fresh_precomputed_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                repository.replace_precomputed_snapshot(
                    "viewer-1",
                    [
                        {
                            "candidateId": "candidate-1",
                            "retrievalScore": 0.91,
                            "rank": 1,
                        }
                    ],
                    datetime.now(timezone.utc).isoformat(),
                    "unit-test",
                    "demo-model",
                )
                rerank_service = Mock()
                rerank_service.rerank.return_value = []
                service = QueryService(repository, rerank_service)

                response = service.query(
                    RecommendationQueryRequest(viewerId="viewer-1", limit=5)
                )

                self.assertEqual(response.source, "precomputed")
                self.assertEqual(response.candidateCount, 1)
                self.assertEqual(response.candidates[0].candidateId, "candidate-1")
                rerank_service.rerank.assert_called_once()
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
                service = QueryService(repository, rerank_service)

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
                repository.replace_precomputed_snapshot(
                    "viewer-2",
                    [
                        {
                            "candidateId": "candidate-z",
                            "retrievalScore": 0.88,
                            "rank": 1,
                        }
                    ],
                    datetime.now(timezone.utc).isoformat(),
                    "unit-test",
                    "demo-model",
                )
                repository.upsert_graph_pair_feature(
                    "viewer-2",
                    "candidate-z",
                    mutual_friend_count=3,
                    common_group_count=1,
                    last_event_type="recommendation.graph.user-unblocked",
                    last_event_at=datetime.now(timezone.utc),
                )

                rerank_service = Mock()
                rerank_service.rerank.return_value = [
                    RecommendationCandidateScore(
                        candidateId="candidate-z",
                        modelScore=0.7,
                        reason="strong",
                    )
                ]
                service = QueryService(repository, rerank_service)

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
                        "graph_recent_unblock",
                    ],
                )
            finally:
                repository.close()


if __name__ == "__main__":
    unittest.main()
