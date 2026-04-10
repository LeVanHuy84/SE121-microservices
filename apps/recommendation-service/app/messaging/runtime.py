import asyncio
import logging

from app.core.config import settings
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler

logger = logging.getLogger(__name__)


class RecommendationMessagingRuntime:
    def __init__(self):
        self.producer = KafkaProducerService(settings.KAFKA_BROKERS)
        self.handler = ProfileEmbeddingEventHandler(self.producer)
        self.consumer = KafkaConsumerService(
            brokers=settings.KAFKA_BROKERS,
            topic=settings.RECOMMENDATION_PROFILE_TOPIC,
            group_id=settings.KAFKA_GROUP_ID,
            handler=self.handler.handle,
        )
        self._consumer_task: asyncio.Task | None = None

    async def start(self):
        await self.producer.start()
        self._consumer_task = asyncio.create_task(self.consumer.start())
        logger.info(
            "Recommendation messaging runtime started: profileTopic=%s resultTopic=%s groupId=%s",
            settings.RECOMMENDATION_PROFILE_TOPIC,
            settings.RECOMMENDATION_RESULT_TOPIC,
            settings.KAFKA_GROUP_ID,
        )

    async def stop(self):
        await self.consumer.stop()

        if self._consumer_task:
            self._consumer_task.cancel()
            await asyncio.gather(self._consumer_task, return_exceptions=True)
            self._consumer_task = None

        await self.producer.stop()
        logger.info("Recommendation messaging runtime stopped")


messaging_runtime = RecommendationMessagingRuntime()
