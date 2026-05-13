import asyncio
import logging

from app.core.config import settings
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_topics import ensure_kafka_topics
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
        await self._ensure_topics_ready()
        self._consumer_tasks = [
            asyncio.create_task(consumer.start()) for consumer in self.consumers
        ]
        for task in self._consumer_tasks:
            task.add_done_callback(self._log_task_failure)
        self._processor_task = asyncio.create_task(
            self.state_processor.start(
                interval_seconds=settings.RECOMMENDATION_STATE_PROCESSOR_INTERVAL_SECONDS
            )
        )
        self._processor_task.add_done_callback(self._log_task_failure)
        logger.info(
            (
                "Recommendation messaging runtime started: profileTopic=%s "
                "graphTopic=%s emotionTopic=%s groupId=%s processorInterval=%s"
            ),
            settings.RECOMMENDATION_PROFILE_TOPIC,
            settings.RECOMMENDATION_GRAPH_TOPIC,
            settings.RECOMMENDATION_EMOTION_TOPIC,
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

    async def _ensure_topics_ready(self):
        topic_init_retries = max(1, int(settings.KAFKA_TOPIC_INIT_RETRIES))
        retry_delay_seconds = float(settings.KAFKA_TOPIC_INIT_RETRY_DELAY_SECONDS)
        topic_wait_timeout_seconds = float(
            settings.KAFKA_TOPIC_INIT_WAIT_TIMEOUT_SECONDS
        )
        target_topics = [
            settings.RECOMMENDATION_PROFILE_TOPIC,
            settings.RECOMMENDATION_GRAPH_TOPIC,
            settings.RECOMMENDATION_EMOTION_TOPIC,
        ]

        last_error: Exception | None = None
        for attempt in range(1, topic_init_retries + 1):
            try:
                await ensure_kafka_topics(
                    settings.KAFKA_BROKERS,
                    target_topics,
                    wait_timeout_seconds=topic_wait_timeout_seconds,
                )
                return
            except Exception as exc:
                last_error = exc
                if attempt >= topic_init_retries:
                    break

                logger.warning(
                    (
                        "Kafka topic initialization retry: attempt=%s/%s "
                        "brokers=%s retryIn=%ss reason=%s"
                    ),
                    attempt,
                    topic_init_retries,
                    settings.KAFKA_BROKERS,
                    retry_delay_seconds,
                    str(exc),
                )
                await asyncio.sleep(retry_delay_seconds)

        raise RuntimeError(
            "Kafka topics are not ready after retries: "
            + ", ".join(target_topics)
        ) from last_error

    def _log_task_failure(self, task: asyncio.Task):
        if task.cancelled():
            return

        error = task.exception()
        if error:
            logger.error(
                "Recommendation messaging task failed",
                exc_info=(type(error), error, error.__traceback__),
            )
