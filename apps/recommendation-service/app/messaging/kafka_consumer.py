import json
import logging

from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaError

logger = logging.getLogger(__name__)


class KafkaConsumerService:
    def __init__(self, brokers: str, topic: str, group_id: str, handler):
        self.brokers = brokers
        self.topic = topic
        self.group_id = group_id
        self.handler = handler
        self.consumer: AIOKafkaConsumer | None = None
        self._running = False

    async def start(self):
        self.consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            enable_auto_commit=False,
            auto_offset_reset="earliest",
            value_deserializer=lambda value: json.loads(value.decode("utf-8")),
            session_timeout_ms=30000,
            heartbeat_interval_ms=10000,
            request_timeout_ms=40000,
            max_poll_interval_ms=300000,
            retry_backoff_ms=1000,
        )

        await self.consumer.start()
        self._running = True

        logger.info(
            "Kafka consumer started: topic=%s groupId=%s brokers=%s",
            self.topic,
            self.group_id,
            self.brokers,
        )

        try:
            async for message in self.consumer:
                event_type = ""
                if isinstance(message.value, dict):
                    event_type = str(message.value.get("type") or "")

                logger.info(
                    (
                        "Kafka message received: topic=%s partition=%s offset=%s "
                        "eventType=%s"
                    ),
                    message.topic,
                    message.partition,
                    message.offset,
                    event_type or "unknown",
                )

                try:
                    await self.handler(message.value)

                    await self.consumer.commit()

                    logger.info(
                        (
                            "Kafka message processed and committed: "
                            "topic=%s partition=%s offset=%s eventType=%s"
                        ),
                        message.topic,
                        message.partition,
                        message.offset,
                        event_type or "unknown",
                    )
                except Exception:
                    logger.exception(
                        (
                            "Kafka message handling failed: topic=%s partition=%s "
                            "offset=%s eventType=%s"
                        ),
                        message.topic,
                        message.partition,
                        message.offset,
                        event_type or "unknown",
                    )
        except KafkaError:
            logger.exception(
                "Kafka consumer loop failed: topic=%s groupId=%s brokers=%s",
                self.topic,
                self.group_id,
                self.brokers,
            )
            raise
        finally:
            await self.stop()

    async def stop(self):
        if self.consumer:
            await self.consumer.stop()
            logger.info(
                "Kafka consumer stopped: topic=%s groupId=%s",
                self.topic,
                self.group_id,
            )
            self.consumer = None
            self._running = False