import asyncio
import logging

from app.core.config import settings
from app.messaging.kafka_consumer import KafkaConsumerService
from app.processors.recommendation_state_processor import RecommendationStateProcessor

logger = logging.getLogger(__name__)


class RecommendationMessagingRuntime:
    def __init__(
        self,
        consumers: list[KafkaConsumerService],
        state_processor: RecommendationStateProcessor,
    ):
        self.consumers = list(consumers)
        self.state_processor = state_processor
        self._consumer_tasks: list[asyncio.Task] = []
        self._processor_task: asyncio.Task | None = None

    async def start(self):
        self._consumer_tasks = [
            asyncio.create_task(consumer.start()) for consumer in self.consumers
        ]
        self._processor_task = asyncio.create_task(
            self.state_processor.start(
                interval_seconds=settings.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS
            )
        )
        logger.info(
            (
                "Recommendation messaging runtime started: profileTopic=%s "
                "graphTopic=%s groupId=%s processorInterval=%s"
            ),
            settings.RECOMMENDATION_PROFILE_TOPIC,
            settings.RECOMMENDATION_GRAPH_TOPIC,
            settings.KAFKA_GROUP_ID,
            settings.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS,
        )

    async def stop(self):
        for consumer in self.consumers:
            await consumer.stop()

        self.state_processor.stop()

        if self._consumer_tasks:
            for task in self._consumer_tasks:
                task.cancel()
            await asyncio.gather(*self._consumer_tasks, return_exceptions=True)
            self._consumer_tasks = []

        if self._processor_task:
            self._processor_task.cancel()
            await asyncio.gather(self._processor_task, return_exceptions=True)
            self._processor_task = None
        logger.info("Recommendation messaging runtime stopped")
