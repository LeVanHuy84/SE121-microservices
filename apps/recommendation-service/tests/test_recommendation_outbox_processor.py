import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.processors.recommendation_outbox_processor import RecommendationOutboxProcessor


class RecommendationOutboxProcessorTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_run_once_publishes_pending_outbox_event(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                event_id = repository.enqueue_outbox_event(
                    "recommendation-result-events",
                    "recommendation.profile.embedding.completed",
                    {
                        "userId": "user-1",
                        "requestId": "req-1",
                    },
                )
                producer = AsyncMock()
                processor = RecommendationOutboxProcessor(repository, producer)

                await processor.run_once()

                producer.send.assert_awaited_once_with(
                    "recommendation-result-events",
                    {
                        "type": "recommendation.profile.embedding.completed",
                        "payload": {
                            "userId": "user-1",
                            "requestId": "req-1",
                        },
                    },
                )
                outbox_event = repository.get_outbox_event(event_id)
                self.assertTrue(outbox_event["processed"])
            finally:
                repository.close()

    async def test_run_once_unlocks_event_when_publish_fails(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            repository = RecommendationStateRepository(
                f"sqlite+pysqlite:///{Path(temp_dir) / 'recommendation-state.sqlite3'}"
            )
            try:
                repository.create_schema()
                event_id = repository.enqueue_outbox_event(
                    "recommendation-result-events",
                    "recommendation.profile.embedding.failed",
                    {
                        "userId": "user-1",
                        "requestId": "req-2",
                    },
                )
                producer = AsyncMock()
                producer.send.side_effect = RuntimeError("kafka down")
                processor = RecommendationOutboxProcessor(repository, producer)

                await processor.run_once()

                outbox_event = repository.get_outbox_event(event_id)
                self.assertFalse(outbox_event["processed"])
                self.assertEqual(outbox_event["attemptCount"], 1)
                self.assertEqual(outbox_event["lastError"], "kafka down")
            finally:
                repository.close()
