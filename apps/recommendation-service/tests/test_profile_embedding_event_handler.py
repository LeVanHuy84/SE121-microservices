import unittest
from unittest.mock import Mock, patch

from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler


class ProfileEmbeddingEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_handle_requested_event_enqueues_completed_result(self):
        repository = Mock()
        handler = ProfileEmbeddingEventHandler(repository)

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

        repository.save_embedding_and_enqueue_result.assert_called_once()
        args = repository.save_embedding_and_enqueue_result.call_args.args
        self.assertEqual(args[0], "user-1")
        self.assertEqual(args[5], "recommendation-result-events")
        self.assertEqual(args[6], "recommendation.profile.embedding.completed")
        self.assertEqual(args[7]["userId"], "user-1")
        self.assertEqual(args[7]["dimensions"], 3)

    async def test_handle_requested_event_enqueues_failed_result_on_error(self):
        repository = Mock()
        handler = ProfileEmbeddingEventHandler(repository)

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

        repository.save_embedding_and_enqueue_result.assert_not_called()
        repository.enqueue_outbox_event.assert_called_once()
        args = repository.enqueue_outbox_event.call_args.args
        self.assertEqual(args[0], "recommendation-result-events")
        self.assertEqual(args[1], "recommendation.profile.embedding.failed")
        self.assertEqual(args[2]["requestId"], "req-2")


if __name__ == "__main__":
    unittest.main()
