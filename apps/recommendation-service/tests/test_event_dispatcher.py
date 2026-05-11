import unittest
from unittest.mock import AsyncMock

from app.messaging.event_dispatcher import RecommendationEventDispatcher


class RecommendationEventDispatcherTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_dispatch_profile_event_to_profile_handler(self):
        profile_handler = AsyncMock()
        graph_handler = AsyncMock()
        emotion_handler = AsyncMock()
        dispatcher = RecommendationEventDispatcher(
            profile_handler, graph_handler, emotion_handler
        )

        event = {
            "type": "recommendation.profile.embedding.requested",
            "payload": {"userId": "user-1"},
        }

        await dispatcher.dispatch(event)

        profile_handler.handle.assert_awaited_once_with(event)
        graph_handler.handle.assert_not_called()
        emotion_handler.handle.assert_not_called()

    async def test_dispatch_graph_event_to_graph_handler(self):
        profile_handler = AsyncMock()
        graph_handler = AsyncMock()
        emotion_handler = AsyncMock()
        dispatcher = RecommendationEventDispatcher(
            profile_handler, graph_handler, emotion_handler
        )

        event = {
            "type": "recommendation.graph.user-blocked",
            "payload": {"userId": "user-1", "targetUserId": "user-2"},
        }

        await dispatcher.dispatch(event)

        graph_handler.handle.assert_awaited_once_with(event)
        profile_handler.handle.assert_not_called()
        emotion_handler.handle.assert_not_called()

    async def test_dispatch_emotion_event_to_emotion_handler(self):
        profile_handler = AsyncMock()
        graph_handler = AsyncMock()
        emotion_handler = AsyncMock()
        dispatcher = RecommendationEventDispatcher(
            profile_handler, graph_handler, emotion_handler
        )

        event = {
            "type": "recommendation.emotion.profile-updated",
            "payload": {"userId": "user-1"},
        }

        await dispatcher.dispatch(event)

        emotion_handler.handle.assert_awaited_once_with(event)
        graph_handler.handle.assert_not_called()
        profile_handler.handle.assert_not_called()


if __name__ == "__main__":
    unittest.main()
