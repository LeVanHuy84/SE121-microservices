import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.messaging.recommendation_graph_event_handler import (
    RecommendationGraphEventHandler,
)


class RecommendationGraphEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repository = RecommendationStateRepository(
            f"sqlite+pysqlite:///{Path(self.temp_dir.name) / 'state.sqlite3'}"
        )
        self.repository.create_schema()
        self.handler = RecommendationGraphEventHandler(self.repository)

    async def asyncTearDown(self):
        self.repository.close()
        self.temp_dir.cleanup()

    async def test_handle_friend_request_and_accept_updates_bidirectional_friendship(
        self,
    ):
        await self.handler.handle(
            {
                "type": "recommendation.graph.friend-request-sent",
                "payload": {
                    "userId": "user-a",
                    "targetUserId": "user-b",
                    "schemaVersion": 1,
                    "occurredAt": datetime.now(timezone.utc).isoformat(),
                    "source": "social-service",
                },
            }
        )
        self.assertTrue(
            self.repository.is_candidate_excluded_by_graph_projection(
                "user-a",
                "user-b",
            )
        )

        await self.handler.handle(
            {
                "type": "recommendation.graph.friend-request-accepted",
                "payload": {
                    "userId": "user-b",
                    "targetUserId": "user-a",
                    "schemaVersion": 1,
                    "occurredAt": datetime.now(timezone.utc).isoformat(),
                    "source": "social-service",
                },
            }
        )
        self.assertTrue(
            self.repository.is_candidate_excluded_by_graph_projection(
                "user-a",
                "user-b",
            )
        )
    async def test_handle_block_clears_friendship_and_pending_request(self):
        await self.handler.handle(
            {
                "type": "recommendation.graph.friend-request-sent",
                "payload": {
                    "userId": "user-a",
                    "targetUserId": "user-b",
                    "schemaVersion": 1,
                    "occurredAt": datetime.now(timezone.utc).isoformat(),
                    "source": "social-service",
                },
            }
        )
        await self.handler.handle(
            {
                "type": "recommendation.graph.user-blocked",
                "payload": {
                    "userId": "user-b",
                    "targetUserId": "user-a",
                    "schemaVersion": 1,
                    "occurredAt": datetime.now(timezone.utc).isoformat(),
                    "source": "social-service",
                },
            }
        )

        self.assertTrue(
            self.repository.is_candidate_excluded_by_graph_projection(
                "user-a",
                "user-b",
            )
        )
    async def test_handle_dismissed_event_tracks_active_dismissal(self):
        await self.handler.handle(
            {
                "type": "recommendation.graph.recommendation-dismissed",
                "payload": {
                    "userId": "viewer-1",
                    "targetUserId": "candidate-1",
                    "schemaVersion": 1,
                    "occurredAt": datetime.now(timezone.utc).isoformat(),
                    "source": "social-service",
                    "expiresAt": (
                        datetime.now(timezone.utc) + timedelta(days=1)
                    ).isoformat(),
                },
            }
        )

        self.assertTrue(
            self.repository.is_candidate_excluded_by_graph_projection(
                "viewer-1",
                "candidate-1",
            )
        )
        journal_rows = self.repository.list_graph_event_journal(limit=10)
        self.assertEqual(len(journal_rows), 1)
        self.assertEqual(
            journal_rows[0]["eventType"],
            "recommendation.graph.recommendation-dismissed",
        )

        pair_features = self.repository.get_graph_pair_features(
            "viewer-1",
            ["candidate-1"],
        )
        self.assertIn("candidate-1", pair_features)
        self.assertTrue(pair_features["candidate-1"].has_active_dismissal)
        self.assertEqual(
            pair_features["candidate-1"].last_event_type,
            "recommendation.graph.recommendation-dismissed",
        )


if __name__ == "__main__":
    unittest.main()
