import asyncio
import logging
from contextlib import asynccontextmanager

from app.core.settings import settings
from app.modules.analysis.messaging.init_kafka import start_kafka, register_consumer
from app.modules.analysis.messaging.kafka_consumer import KafkaConsumerService
from app.modules.analysis.messaging.kafka_producer import KafkaProducerService
from app.modules.analysis.messaging.batch_processor import OutboxBatchProcessor
from app.modules.analysis.repositories.outbox import OutboxRepository
from app.modules.analysis.repositories.mongo import collections, db
from app.modules.analysis.messaging.event_dispatcher import EventDispatcher
from app.modules.analysis.services.orchestration.handle_event_service import HandleEventService
from app.modules.analysis.repositories.outbox import ModerationRepository
from app.modules.analysis.repositories.outbox import TaskRepository
from app.modules.analysis.messaging.retry_worker import RetryWorker
from app.modules.analysis.services.ml_models.model_loader import ensure_models_loaded, get_model_health  # noqa: F401
from app.modules.analysis.services.orchestration.analysis_flow_service import AnalysisFlowService
from app.modules.analysis.repositories.emotion import EmotionAggregateRepository
from app.modules.analysis.repositories.idempotency import IdempotencyRepository
from app.modules.analysis.messaging.dlq_service import KafkaDLQService
from app.modules.analysis.messaging.consumer_helper import KafkaConsumerHelper

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

# -------------------------------------------------------
# INIT SINGLETONS - Now using Motor collections
# -------------------------------------------------------
outbox_repo = OutboxRepository(collections['outbox_events'])
emotion_aggregate_repo = EmotionAggregateRepository(collections['emotion_aggregates'])
moderation_repo = ModerationRepository(collections['moderation_results'])
task_repo = TaskRepository(collections['analysis_tasks'])
idempotency_repo = IdempotencyRepository(collections['processed_events'])

# Inject repositories vào analysis_flow_service
analysis_flow_service = AnalysisFlowService(
    moderation_repo,
    emotion_aggregate_repo
)

kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)
dlq_service = KafkaDLQService(kafka_producer)
consumer_helper = KafkaConsumerHelper(idempotency_repo, dlq_service)

processor = OutboxBatchProcessor(outbox_repo, kafka_producer)
retry_worker = RetryWorker(
    emotion_aggregate_repo,
    moderation_repo,
    task_repo,
    outbox_repo
)

event_service = HandleEventService(
    analysis_flow_service,
    emotion_aggregate_repo,
    moderation_repo,
    task_repo,
    outbox_repo,
)
dispatcher = EventDispatcher(event_service)

# -------------------------------------------------------
# Kafka Consumer Handlers
# -------------------------------------------------------
async def handle_analysis_event(msg):
    logger.info("Received single message: %s", msg)
    await consumer_helper.handle_single(msg, dispatcher.dispatch, topic="analysis-events")


async def handle_batch_analysis_events(messages: list):
    logger.info("Received batch of %d messages from Kafka", len(messages))
    await consumer_helper.handle_batch(messages, dispatcher.dispatch, topic="analysis-events")


# QUAN TRỌNG: phải register consumer với batch_handler
register_consumer(
    KafkaConsumerService(
        brokers=settings.KAFKA_BROKERS,
        topic="analysis-events",
        group_id=settings.KAFKA_CLIENT_ID,
        handler=handle_analysis_event,
        batch_handler=handle_batch_analysis_events,
    )
)

# -------------------------------------------------------
# DATABASE INITIALIZATION
# -------------------------------------------------------
async def init_database():
    try:
        await db['emotion_aggregates'].create_index([("userId", 1), ("createdAt", 1)], name="idx_userId_createdAt")
        await db['processed_events'].create_index([("updatedAt", 1)], expireAfterSeconds=604800, name="idx_ttl_7days")
        logger.info("[DB Init] All indexes verified (including processed_events TTL)")
    except Exception as e:
        logger.warning(f"[DB Init] Index creation warning: {e}")

# -------------------------------------------------------
# LIFESPAN
# -------------------------------------------------------
@asynccontextmanager
async def lifespan(app):
    background_tasks: list[asyncio.Task] = []

    try:
        logger.info("=" * 70)
        logger.info("[Startup] Analysis Service V2.0 - Starting up...")
        logger.info("=" * 70)

        # 0. Database initialization (indexes)
        logger.info("[Startup] Step 0/5: Initializing database indexes...")
        await init_database()
        logger.info("[Startup] Database indexes ready")

        # 1. Load AI Models FIRST (chặn startup để load models)
        logger.info("[Startup] Step 1/5: Loading AI models...")
        await asyncio.to_thread(ensure_models_loaded)
        logger.info("[Startup] AI models ready")

        # 2. Kafka Producer
        logger.info("[Startup] Step 2/5: Starting Kafka Producer...")
        await kafka_producer.start()
        logger.info("[Startup] Kafka Producer started")

        # 3. Kafka Consumer loop
        logger.info("[Startup] Step 3/5: Starting Kafka Consumer...")
        background_tasks.append(
            asyncio.create_task(start_kafka(settings))
        )
        logger.info("[Startup] Kafka Consumer started")

        # 4. Outbox processor
        logger.info("[Startup] Step 4/5: Starting Outbox Processor...")
        background_tasks.append(
            asyncio.create_task(processor.start(interval_seconds=5))
        )
        logger.info("[Startup] Outbox Processor started")

        # 5. Retry worker
        logger.info("[Startup] Step 5/5: Starting Retry Worker...")
        background_tasks.append(
            asyncio.create_task(retry_worker.start())
        )
        logger.info("[Startup] Retry Worker started")

        logger.info("=" * 70)
        logger.info("[Startup] Analysis Service V2.0 - Fully operational!")
        logger.info("=" * 70)

        yield  # ← FastAPI chạy tại đây

    except Exception as e:
        logger.exception("[Startup] Lifespan startup failed: %s", e)
        raise

    finally:
        logger.info("=" * 70)
        logger.info("[Shutdown] Analysis Service - Shutting down...")
        logger.info("=" * 70)

        processor.stop()
        retry_worker.stop()

        await kafka_producer.stop()
        logger.info("[Shutdown] Kafka Producer stopped")

        for task in background_tasks:
            task.cancel()

        await asyncio.gather(*background_tasks, return_exceptions=True)
        logger.info("=" * 70)
        logger.info("[Shutdown] Analysis Service - Shutdown complete")
        logger.info("=" * 70)
