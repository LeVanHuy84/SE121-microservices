import asyncio
import json
import logging
from aiokafka import AIOKafkaProducer
from aiokafka.errors import KafkaConnectionError, KafkaError

logger = logging.getLogger(__name__)


class KafkaProducerService:
    def __init__(self, brokers: str):
        self.brokers = brokers
        self.producer: AIOKafkaProducer | None = None

    async def start(self, max_retries: int = 10, retry_interval: float = 3.0):
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.brokers,
            acks="all",
            linger_ms=5,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        for attempt in range(1, max_retries + 1):
            try:
                await self.producer.start()
                logger.info(
                    "[KafkaProducer] Connected successfully to %s", self.brokers
                )
                return
            except (KafkaConnectionError, KafkaError, Exception) as exc:
                if attempt == max_retries:
                    logger.error(
                        "[KafkaProducer] Failed to connect after %d attempts: %s",
                        attempt,
                        exc,
                    )
                    raise
                logger.warning(
                    "[KafkaProducer] Connection attempt %d/%d failed: %s. Retrying in %ss...",
                    attempt,
                    max_retries,
                    exc,
                    retry_interval,
                )
                await asyncio.sleep(retry_interval)

    async def stop(self):
        if self.producer:
            await self.producer.stop()

    async def send(self, topic: str, message: dict):
        if not self.producer:
            raise RuntimeError("Kafka producer is not started")
        await self.producer.send_and_wait(topic, message)
