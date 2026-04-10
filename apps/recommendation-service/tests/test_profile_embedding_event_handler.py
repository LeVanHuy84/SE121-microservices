import unittest
from unittest.mock import AsyncMock, patch

from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler


class ProfileEmbeddingEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_handle_requested_event_publishes_completed_result(self):
        producer = AsyncMock()
        handler = ProfileEmbeddingEventHandler(producer)

        with patch(
            "app.messaging.profile_embedding_event_handler.model_loader.encode_profile_texts",
            return_value=[[0.1, 0.2, 0.3]],
        ):
            await handler.handle(
                {
                    "type": "recommendation.profile.embedding.requested",
                    "payload": {
                        "userId": "user-1",
                        "semanticProfileText": "name: An\nbio: backend engineer",
                        "requestId": "req-1",
                        "schemaVersion": 1,
                    },
                }
            )

        producer.send.assert_awaited_once()
        topic, message = producer.send.await_args.args
        self.assertEqual(topic, "recommendation-result-events")
        self.assertEqual(
            message["type"], "recommendation.profile.embedding.completed"
        )
        self.assertEqual(message["payload"]["userId"], "user-1")
        self.assertEqual(message["payload"]["dimensions"], 3)

    async def test_handle_requested_event_publishes_failed_result_on_error(self):
        producer = AsyncMock()
        handler = ProfileEmbeddingEventHandler(producer)

        with patch(
            "app.messaging.profile_embedding_event_handler.model_loader.encode_profile_texts",
            side_effect=RuntimeError("model failed"),
        ):
            await handler.handle(
                {
                    "type": "recommendation.profile.embedding.requested",
                    "payload": {
                        "userId": "user-1",
                        "semanticProfileText": "name: An",
                        "requestId": "req-2",
                        "schemaVersion": 1,
                    },
                }
            )

        topic, message = producer.send.await_args.args
        self.assertEqual(topic, "recommendation-result-events")
        self.assertEqual(message["type"], "recommendation.profile.embedding.failed")
        self.assertEqual(message["payload"]["requestId"], "req-2")


if __name__ == "__main__":
    unittest.main()
