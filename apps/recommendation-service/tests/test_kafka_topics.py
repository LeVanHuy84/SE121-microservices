import unittest
from unittest.mock import AsyncMock, Mock, patch

from app.messaging.kafka_topics import ensure_kafka_topics


class KafkaTopicsTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_ensure_kafka_topics_creates_missing_topics(self):
        admin_client = Mock()
        admin_client.start = AsyncMock()
        admin_client.close = AsyncMock()
        admin_client.list_topics = AsyncMock(
            side_effect=[
                {"existing-topic"},
                {"existing-topic", "new-topic"},
            ]
        )
        admin_client.create_topics = AsyncMock()

        with patch(
            "app.messaging.kafka_topics.AIOKafkaAdminClient",
            return_value=admin_client,
        ):
            await ensure_kafka_topics(
                "localhost:9092",
                ["existing-topic", "new-topic", "new-topic"],
            )

        admin_client.start.assert_awaited_once()
        admin_client.create_topics.assert_awaited_once()
        created_topics = admin_client.create_topics.await_args.args[0]
        self.assertEqual(len(created_topics), 1)
        self.assertEqual(created_topics[0].name, "new-topic")
        admin_client.close.assert_awaited_once()

    async def test_ensure_kafka_topics_skips_existing_topics(self):
        admin_client = Mock()
        admin_client.start = AsyncMock()
        admin_client.close = AsyncMock()
        admin_client.list_topics = AsyncMock(return_value={"existing-topic"})
        admin_client.create_topics = AsyncMock()

        with patch(
            "app.messaging.kafka_topics.AIOKafkaAdminClient",
            return_value=admin_client,
        ):
            await ensure_kafka_topics("localhost:9092", ["existing-topic"])

        admin_client.create_topics.assert_not_called()
        admin_client.close.assert_awaited_once()

    async def test_ensure_kafka_topics_raises_when_topics_unavailable_after_wait(
        self,
    ):
        admin_client = Mock()
        admin_client.start = AsyncMock()
        admin_client.close = AsyncMock()
        admin_client.list_topics = AsyncMock(return_value=set())
        admin_client.create_topics = AsyncMock()

        with patch(
            "app.messaging.kafka_topics.AIOKafkaAdminClient",
            return_value=admin_client,
        ):
            with self.assertRaises(RuntimeError):
                await ensure_kafka_topics(
                    "localhost:9092",
                    ["new-topic"],
                    wait_timeout_seconds=0.2,
                    wait_poll_interval_seconds=0.1,
                )

        admin_client.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
