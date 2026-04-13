import asyncio
import logging
from time import monotonic

from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.errors import TopicAlreadyExistsError

logger = logging.getLogger(__name__)


async def ensure_kafka_topics(
    brokers: str,
    topics: list[str],
    *,
    num_partitions: int = 1,
    replication_factor: int = 1,
    wait_timeout_seconds: float = 15.0,
    wait_poll_interval_seconds: float = 0.5,
):
    topic_names = sorted({topic.strip() for topic in topics if topic.strip()})
    if not topic_names:
        return

    admin_client = AIOKafkaAdminClient(bootstrap_servers=brokers)
    await admin_client.start()
    try:
        existing_topics = await admin_client.list_topics()
        missing_topics = [
            topic for topic in topic_names if topic not in existing_topics
        ]
        if not missing_topics:
            return

        try:
            await admin_client.create_topics(
                [
                    NewTopic(
                        name=topic,
                        num_partitions=num_partitions,
                        replication_factor=replication_factor,
                    )
                    for topic in missing_topics
                ]
            )
            logger.info("Created Kafka topics: %s", ", ".join(missing_topics))
        except TopicAlreadyExistsError:
            logger.info("Kafka topics already exist: %s", ", ".join(missing_topics))

        await _wait_until_topics_available(
            admin_client,
            topic_names,
            wait_timeout_seconds=wait_timeout_seconds,
            wait_poll_interval_seconds=wait_poll_interval_seconds,
        )
    finally:
        await admin_client.close()


async def _wait_until_topics_available(
    admin_client: AIOKafkaAdminClient,
    topic_names: list[str],
    *,
    wait_timeout_seconds: float,
    wait_poll_interval_seconds: float,
):
    deadline = monotonic() + max(1.0, float(wait_timeout_seconds))
    pending_topics = set(topic_names)

    while pending_topics:
        existing_topics = await admin_client.list_topics()
        pending_topics = {
            topic_name
            for topic_name in pending_topics
            if topic_name not in existing_topics
        }
        if not pending_topics:
            return

        if monotonic() >= deadline:
            raise RuntimeError(
                "Kafka topic metadata unavailable after initialization: "
                + ", ".join(sorted(pending_topics))
            )

        await asyncio.sleep(max(0.1, float(wait_poll_interval_seconds)))
