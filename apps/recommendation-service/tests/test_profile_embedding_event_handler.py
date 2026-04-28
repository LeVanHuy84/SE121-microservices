import unittest
from unittest.mock import Mock, patch

from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler


class ProfileEmbeddingEventHandlerTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_handle_requested_event_persists_embedding(self):
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

        repository.upsert_profile_embedding.assert_called_once()
        args = repository.upsert_profile_embedding.call_args.args
        self.assertEqual(args[0], "user-1")
        self.assertEqual(args[2], [0.1, 0.2, 0.3])

    async def test_handle_requested_event_logs_failure_on_error(self):
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

        repository.upsert_profile_embedding.assert_not_called()

    async def test_handle_requested_event_with_null_profile_clears_embedding(self):
        repository = Mock()
        handler = ProfileEmbeddingEventHandler(repository)

        await handler.handle(
            {
                "type": "recommendation.profile.embedding.requested",
                "payload": {
                    "userId": "user-2",
                    "semanticProfileText": None,
                    "requestId": "req-3",
                    "schemaVersion": 1,
                },
            }
        )

        repository.delete_profile_embedding.assert_called_once_with("user-2")
        repository.upsert_profile_embedding.assert_not_called()

    async def test_handle_requested_event_skips_when_profile_unchanged(self):
        repository = Mock()
        repository.get_profile_embedding.return_value = {
            "userId": "user-3",
            "semanticProfileText": "name: Lan",
            "embedding": [0.2, 0.3],
            "dimensions": 2,
            "modelName": "demo-model",
            "updatedAt": "2026-04-13T10:00:00+00:00",
        }
        handler = ProfileEmbeddingEventHandler(repository)

        with patch(
            "app.messaging.profile_embedding_event_handler.model_loader.encode_profile_texts"
        ) as encode:
            await handler.handle(
                {
                    "type": "recommendation.profile.embedding.requested",
                    "payload": {
                        "userId": "user-3",
                        "semanticProfileText": "name: Lan",
                        "requestId": "req-4",
                        "schemaVersion": 1,
                    },
                }
            )

        encode.assert_not_called()
        repository.upsert_profile_embedding.assert_not_called()
        repository.delete_profile_embedding.assert_not_called()


if __name__ == "__main__":
    unittest.main()
