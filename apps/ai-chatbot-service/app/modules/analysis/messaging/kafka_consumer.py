import asyncio
import json
import logging
from aiokafka import AIOKafkaConsumer
from app.core.settings import settings

logger = logging.getLogger(__name__)


class KafkaConsumerService:
    def __init__(self, brokers: str, topic: str, group_id: str, handler=None, batch_handler=None):
        self.brokers = brokers
        self.topic = topic
        self.group_id = group_id
        self.handler = handler
        self.batch_handler = batch_handler
        self.consumer: AIOKafkaConsumer | None = None
        self._running = False

    async def start(self):
        self.consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            enable_auto_commit=True,
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        await self.consumer.start()
        self._running = True

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

    async def stop(self):
        self._running = False
        if self.consumer:
            await self.consumer.stop()

