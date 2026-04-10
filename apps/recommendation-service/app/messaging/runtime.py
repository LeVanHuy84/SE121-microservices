import asyncio
import logging

from app.core.config import settings
from app.messaging.event_dispatcher import RecommendationEventDispatcher
from app.messaging.init_kafka import register_consumer, start_kafka
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.messaging.profile_embedding_event_handler import ProfileEmbeddingEventHandler
from app.messaging.recommendation_graph_event_handler import (
    RecommendationGraphEventHandler,
)
from app.processors.recommendation_outbox_processor import (
    RecommendationOutboxProcessor,
)
from app.processors.recommendation_state_processor import (
    recommendation_state_processor,
    state_repository,
)

logger = logging.getLogger(__name__)


class RecommendationMessagingRuntime:
    def __init__(self):
        self.producer = KafkaProducerService(settings.KAFKA_BROKERS)
        self.profile_handler = ProfileEmbeddingEventHandler(state_repository)
        self.graph_handler = RecommendationGraphEventHandler()
        self.outbox_processor = RecommendationOutboxProcessor(
            state_repository,
            self.producer,
        )
        self.dispatcher = RecommendationEventDispatcher(
            self.profile_handler,
            self.graph_handler,
        )
        self.profile_consumer = KafkaConsumerService(
            brokers=settings.KAFKA_BROKERS,
            topic=settings.RECOMMENDATION_PROFILE_TOPIC,
            group_id=settings.KAFKA_GROUP_ID,
            handler=self.dispatcher.dispatch,
        )
        self.graph_consumer = KafkaConsumerService(
            brokers=settings.KAFKA_BROKERS,
            topic=settings.RECOMMENDATION_GRAPH_TOPIC,
            group_id=settings.KAFKA_GROUP_ID,
            handler=self.dispatcher.dispatch,
        )
        register_consumer(self.profile_consumer)
        register_consumer(self.graph_consumer)
        self._consumer_tasks: list[asyncio.Task] = []
        self._processor_task: asyncio.Task | None = None
        self._outbox_task: asyncio.Task | None = None

    async def start(self):
        await self.producer.start()
        self._consumer_tasks = await start_kafka()
        self._processor_task = asyncio.create_task(
            recommendation_state_processor.start(
                interval_seconds=settings.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS
            )
        )
        self._outbox_task = asyncio.create_task(
            self.outbox_processor.start(
                interval_seconds=settings.RECOMMENDATION_OUTBOX_PROCESSOR_INTERVAL_SECONDS
            )
        )
        logger.info(
            "Recommendation messaging runtime started: profileTopic=%s graphTopic=%s resultTopic=%s groupId=%s processorInterval=%s outboxInterval=%s",
            settings.RECOMMENDATION_PROFILE_TOPIC,
            settings.RECOMMENDATION_GRAPH_TOPIC,
            settings.RECOMMENDATION_RESULT_TOPIC,
            settings.KAFKA_GROUP_ID,
            settings.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS,
            settings.RECOMMENDATION_OUTBOX_PROCESSOR_INTERVAL_SECONDS,
        )

    async def stop(self):
        await self.profile_consumer.stop()
        await self.graph_consumer.stop()
        recommendation_state_processor.stop()
        self.outbox_processor.stop()

        if self._consumer_tasks:
            for task in self._consumer_tasks:
                task.cancel()
            await asyncio.gather(*self._consumer_tasks, return_exceptions=True)
            self._consumer_tasks = []

        if self._processor_task:
            self._processor_task.cancel()
            await asyncio.gather(self._processor_task, return_exceptions=True)
            self._processor_task = None

        if self._outbox_task:
            self._outbox_task.cancel()
            await asyncio.gather(self._outbox_task, return_exceptions=True)
            self._outbox_task = None

        await self.producer.stop()
        logger.info("Recommendation messaging runtime stopped")


messaging_runtime = RecommendationMessagingRuntime()
