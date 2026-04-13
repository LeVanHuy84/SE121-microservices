import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database.recommendation_state_repository import RecommendationStateRepository


class RecommendationStateRepositoryTestCase(unittest.TestCase):
    def test_upsert_embedding_and_read_precomputed_snapshot(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()

                repository.upsert_profile_embedding(
                    "viewer-1",
                    "name: Viewer",
                    [0.1, 0.2],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                )
                repository.replace_precomputed_snapshot(
                    "viewer-1",
                    [
                        {
                            "candidateId": "candidate-1",
                            "semanticScore": 0.91,
                            "rank": 1,
                        },
                        {
                            "candidateId": "candidate-2",
                            "semanticScore": 0.82,
                            "rank": 2,
                        },
                    ],
                    "2026-04-10T00:01:00+00:00",
                    "unit-test",
                    "demo-model",
                    "retrieval-pgvector-v1",
                )

                embedding = repository.get_profile_embedding("viewer-1")
                snapshot = repository.get_precomputed_snapshot("viewer-1", 10)

                self.assertEqual(embedding["userId"], "viewer-1")
                self.assertEqual(snapshot["viewerId"], "viewer-1")
                self.assertEqual(snapshot["scoreVersion"], "retrieval-pgvector-v1")
                self.assertEqual(snapshot["candidateCount"], 2)
                self.assertEqual(
                    snapshot["candidates"][0]["candidateId"], "candidate-1"
                )
                self.assertEqual(snapshot["candidates"][0]["retrievalScore"], 0.91)
                self.assertEqual(snapshot["candidates"][0]["precomputeScore"], 0.91)
            finally:
                repository.close()

    def test_save_embedding_and_enqueue_result_persists_both_records(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()

                event_id = repository.save_embedding_and_enqueue_result(
                    "viewer-1",
                    "name: Viewer",
                    [0.1, 0.2],
                    "demo-model",
                    "2026-04-10T00:00:00+00:00",
                    "recommendation-result-events",
                    "recommendation.profile.embedding.completed",
                    {
                        "userId": "viewer-1",
                        "requestId": "req-1",
                    },
                )

                embedding = repository.get_profile_embedding("viewer-1")
                outbox_event = repository.get_outbox_event(event_id)

                self.assertEqual(embedding["dimensions"], 2)
                self.assertEqual(outbox_event["topic"], "recommendation-result-events")
                self.assertEqual(
                    outbox_event["eventType"],
                    "recommendation.profile.embedding.completed",
                )
            finally:
                repository.close()

    def test_graph_projection_filters_relationship_state(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()

                repository.apply_graph_friend_request_sent("user-a", "user-b")
                self.assertTrue(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_friend_request_canceled("user-a", "user-b")
                self.assertFalse(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_friend_request_sent("user-a", "user-b")
                repository.apply_graph_friend_request_accepted("user-b", "user-a")
                self.assertTrue(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_friendship_removed("user-a", "user-b")
                self.assertFalse(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_user_blocked("user-a", "user-b")
                self.assertTrue(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_user_unblocked("user-a", "user-b")
                self.assertFalse(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )

                repository.apply_graph_recommendation_dismissed(
                    "user-a",
                    "user-b",
                    datetime.now(timezone.utc) + timedelta(days=1),
                )
                self.assertTrue(
                    repository.is_candidate_excluded_by_graph_projection(
                        "user-a",
                        "user-b",
                    )
                )
            finally:
                repository.close()
