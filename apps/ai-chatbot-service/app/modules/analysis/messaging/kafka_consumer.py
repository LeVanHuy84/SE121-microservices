import asyncio
import json
import logging
from aiokafka import AIOKafkaConsumer
from aiokafka.errors import KafkaConnectionError, KafkaError
from app.core.settings import settings

logger = logging.getLogger(__name__)


class KafkaConsumerService:
    def __init__(
        self, brokers: str, topic: str, group_id: str, handler=None, batch_handler=None
    ):
        self.brokers = brokers
        self.topic = topic
        self.group_id = group_id
        self.handler = handler
        self.batch_handler = batch_handler
        self.consumer: AIOKafkaConsumer | None = None
        self._running = False

    async def start(self, max_retries: int = 10, retry_interval: float = 3.0):
        self.consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            enable_auto_commit=False,
            auto_offset_reset="latest",
            session_timeout_ms=45000,
            heartbeat_interval_ms=15000,
            max_poll_interval_ms=300000,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        for attempt in range(1, max_retries + 1):
            try:
                await self.consumer.start()
                self._running = True
                logger.info(
                    "[KafkaConsumer] Connected successfully to %s (topic: %s)",
                    self.brokers,
                    self.topic,
                )
                break
            except (KafkaConnectionError, KafkaError, Exception) as exc:
                if attempt == max_retries:
                    logger.error(
                        "[KafkaConsumer] Failed to connect after %d attempts: %s",
                        attempt,
                        exc,
                    )
                    raise
                logger.warning(
                    "[KafkaConsumer] Connection attempt %d/%d failed: %s. Retrying in %ss...",
                    attempt,
                    max_retries,
                    exc,
                    retry_interval,
                )
                await asyncio.sleep(retry_interval)

        if self.batch_handler:
            await self._run_batch_loop()
        else:
            await self._run_single_loop()

    async def _run_batch_loop(self):
        max_records = settings.KAFKA_CONSUMER_BATCH_SIZE
        timeout_ms = int(settings.KAFKA_CONSUMER_BATCH_TIMEOUT_SEC * 1000)

        while self._running:
            try:
                records = await self.consumer.getmany(
                    timeout_ms=timeout_ms,
                    max_records=max_records,
                )

                messages = []
                for tp, msgs in records.items():
                    for msg in msgs:
                        messages.append(msg.value)

                if messages:
                    try:
                        await self.batch_handler(messages)
                    except Exception as e:
                        logger.error("[KafkaConsumer] Batch handler error: %s", e)
                    try:
                        await self.consumer.commit()
                    except Exception as commit_err:
                        logger.warning("[KafkaConsumer] Offset commit warning (batch): %s", commit_err)
                else:
                    await asyncio.sleep(0.1)
            except Exception as e:
                logger.error("[KafkaConsumer] Consumer loop error: %s", e)
                await asyncio.sleep(1.0)

    async def _run_single_loop(self):
        async for msg in self.consumer:
            if not self._running:
                break
            try:
                if self.handler:
                    await self.handler(msg.value)
            except Exception as e:
                logger.error("[KafkaConsumer] Single handler error: %s", e)
            try:
                await self.consumer.commit()
            except Exception as commit_err:
                logger.warning("[KafkaConsumer] Offset commit warning (single): %s", commit_err)
            await asyncio.sleep(0)

    async def stop(self):
        self._running = False
        if self.consumer:
            await self.consumer.stop()
