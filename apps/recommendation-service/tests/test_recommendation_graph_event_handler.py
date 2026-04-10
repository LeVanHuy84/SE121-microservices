import unittest
from datetime import datetime, timedelta, timezone

from app.messaging.recommendation_graph_event_handler import (
    RecommendationGraphEventHandler,
)
from app.services.graph_state_store import RecommendationGraphStateStore


class RecommendationGraphEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.handler = RecommendationGraphEventHandler()
        self.store = RecommendationGraphStateStore()

        import app.messaging.recommendation_graph_event_handler as handler_module

        self.original_store = handler_module.graph_state_store
        handler_module.graph_state_store = self.store

    async def asyncTearDown(self):
        import app.messaging.recommendation_graph_event_handler as handler_module

        handler_module.graph_state_store = self.original_store

    async def test_handle_friend_request_and_accept_updates_bidirectional_friendship(self):
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
        self.assertTrue(self.store.has_pending_request("user-a", "user-b"))

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
        self.assertFalse(self.store.has_pending_request("user-a", "user-b"))
        self.assertTrue(self.store.has_friendship("user-a", "user-b"))
        self.assertTrue(self.store.has_friendship("user-b", "user-a"))

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

        self.assertFalse(self.store.has_pending_request("user-a", "user-b"))
        self.assertTrue(self.store.is_blocked("user-b", "user-a"))

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
            self.store.has_active_dismissal("viewer-1", "candidate-1")
        )


if __name__ == "__main__":
    unittest.main()
