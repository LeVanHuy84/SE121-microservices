import asyncio
import logging
from contextlib import asynccontextmanager

from app.core.config import settings
from app.messaging.init_kafka import start_kafka, register_consumer
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.processors.batch_processor import OutboxBatchProcessor
from app.database.outbox_repository import OutboxRepository
from app.database.mongo_client import engine
from app.messaging.event_dispatcher import EventDispatcher
from app.services.handle_event_service import HandleEventService
from app.database.analysis_repository import AnalysisRepository
from app.processors.retry_worker import RetryWorker

logger = logging.getLogger(__name__)

# -------------------------------------------------------
# INIT SINGLETONS (GIỐNG BẢN CŨ)
# -------------------------------------------------------
outbox_repo = OutboxRepository(engine)
analysis_repo = AnalysisRepository(engine)

kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)
processor = OutboxBatchProcessor(outbox_repo, kafka_producer)
retry_worker = RetryWorker(analysis_repo, outbox_repo)

event_service = HandleEventService(analysis_repo)
dispatcher = EventDispatcher(event_service, outbox_repo)

# -------------------------------------------------------
# Kafka Consumer Handler
# -------------------------------------------------------
async def handle_analysis_event(msg):
    logger.info("Received message: %s", msg)
    await dispatcher.dispatch(msg)


# 👉 QUAN TRỌNG: phải register consumer
register_consumer(
    KafkaConsumerService(
        brokers=settings.KAFKA_BROKERS,
        topic="analysis-events",
        group_id=settings.KAFKA_CLIENT_ID,
        handler=handle_analysis_event,
    )
)

# -------------------------------------------------------
# LIFESPAN
# -------------------------------------------------------
@asynccontextmanager
async def lifespan(app):
    background_tasks: list[asyncio.Task] = []

    try:
        logger.info("🚀 Application startup")

        # Kafka Producer
        await kafka_producer.start()
        logger.info("[KafkaProducer] Started")

        # Kafka Consumer loop
        background_tasks.append(
            asyncio.create_task(start_kafka(settings))
        )
        logger.info("[KafkaConsumer] Started")

        # Outbox processor
        background_tasks.append(
            asyncio.create_task(processor.start(interval_seconds=5))
        )
        logger.info("[OutboxBatchProcessor] Started")

        # Retry worker
        background_tasks.append(
            asyncio.create_task(retry_worker.start())
        )
        logger.info("[RetryWorker] Started")

        yield  # ← FastAPI chạy tại đây

    except Exception as e:
        logger.exception("❌ Lifespan startup failed: %s", e)
        raise

    finally:
        logger.info("🛑 Application shutdown")

        processor.stop()
        retry_worker.stop()

        await kafka_producer.stop()
        logger.info("[KafkaProducer] Stopped")

        for task in background_tasks:
            task.cancel()

        await asyncio.gather(*background_tasks, return_exceptions=True)
        logger.info("✅ All background tasks stopped cleanly")
