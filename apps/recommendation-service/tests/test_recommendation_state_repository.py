import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database.recommendation_state_repository import RecommendationStateRepository


class RecommendationStateRepositoryTestCase(unittest.TestCase):
    def test_upsert_embedding_and_read_global_fallback_candidates(self):
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
                repository.replace_global_fallback_candidates(
                    [
                        {
                            "candidateId": "candidate-1",
                            "fallbackScore": 0.91,
                            "rank": 1,
                        },
                        {
                            "candidateId": "candidate-2",
                            "fallbackScore": 0.82,
                            "rank": 2,
                        },
                    ],
                    "2026-04-10T00:01:00+00:00",
                    "global-fallback-v1",
                )

                embedding = repository.get_profile_embedding("viewer-1")
                candidates = repository.list_global_fallback_candidates(0, 10)

                self.assertEqual(embedding["userId"], "viewer-1")
                self.assertEqual(len(candidates), 2)
                self.assertEqual(candidates[0]["candidateId"], "candidate-1")
                self.assertEqual(candidates[0]["fallbackScore"], 0.91)
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

    def test_graph_event_journal_and_pair_features(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()

                occurred_at = datetime.now(timezone.utc)
                repository.record_graph_event(
                    event_type="recommendation.graph.friend-request-sent",
                    user_id="viewer-1",
                    target_user_id="candidate-1",
                    occurred_at=occurred_at,
                    source="social-service",
                    payload={
                        "userId": "viewer-1",
                        "targetUserId": "candidate-1",
                        "schemaVersion": 1,
                    },
                )
                repository.apply_graph_friend_request_sent("viewer-1", "candidate-1")
                repository.refresh_graph_pair_features_for_event(
                    "viewer-1",
                    "candidate-1",
                    "recommendation.graph.friend-request-sent",
                    occurred_at,
                )

                journal_rows = repository.list_graph_event_journal(limit=10)
                self.assertEqual(len(journal_rows), 1)
                self.assertEqual(
                    journal_rows[0]["eventType"],
                    "recommendation.graph.friend-request-sent",
                )

                pair_features = repository.get_graph_pair_features(
                    "viewer-1",
                    ["candidate-1"],
                )
                self.assertIn("candidate-1", pair_features)
                self.assertTrue(pair_features["candidate-1"]["hasPendingRequest"])
                self.assertFalse(pair_features["candidate-1"]["hasFriendship"])
                self.assertFalse(pair_features["candidate-1"]["isBlockedEitherWay"])
                self.assertEqual(
                    pair_features["candidate-1"]["lastEventType"],
                    "recommendation.graph.friend-request-sent",
                )
            finally:
                repository.close()

    def test_graph_pair_features_computes_mutual_friend_count(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()

                repository.apply_graph_friend_request_accepted(
                    "viewer-1",
                    "mutual-1",
                )
                repository.apply_graph_friend_request_accepted(
                    "candidate-1",
                    "mutual-1",
                )

                pair_features = repository.get_graph_pair_features(
                    "viewer-1",
                    ["candidate-1"],
                )

                self.assertEqual(
                    pair_features["candidate-1"]["mutualFriendCount"],
                    1,
                )
                self.assertFalse(pair_features["candidate-1"]["hasFriendship"])

                repository.upsert_graph_pair_feature(
                    "viewer-1",
                    "candidate-2",
                    mutual_friend_count=5,
                )
                refreshed_pair_features = repository.get_graph_pair_features(
                    "viewer-1",
                    ["candidate-2"],
                )
                self.assertEqual(
                    refreshed_pair_features["candidate-2"]["mutualFriendCount"],
                    0,
                )
            finally:
                repository.close()
