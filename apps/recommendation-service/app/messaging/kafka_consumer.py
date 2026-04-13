import json
import logging

from aiokafka import AIOKafkaConsumer

logger = logging.getLogger(__name__)


class KafkaConsumerService:
    def __init__(self, brokers: str, topic: str, group_id: str, handler):
        self.brokers = brokers
        self.topic = topic
        self.group_id = group_id
        self.handler = handler
        self.consumer: AIOKafkaConsumer | None = None

    async def start(self):
        self.consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            enable_auto_commit=True,
            auto_offset_reset="earliest",
            value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        )
        await self.consumer.start()
        logger.info(
            "Kafka consumer started: topic=%s groupId=%s brokers=%s",
            self.topic,
            self.group_id,
            self.brokers,
        )

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
            await self.handler(message.value)

    async def stop(self):
        if self.consumer:
            await self.consumer.stop()
            logger.info(
                "Kafka consumer stopped: topic=%s groupId=%s",
                self.topic,
                self.group_id,
            )
