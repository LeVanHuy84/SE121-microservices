import asyncio
import logging
from contextlib import asynccontextmanager

from app.core.config import settings
from app.messaging.init_kafka import start_kafka, register_consumer
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.processors.batch_processor import OutboxBatchProcessor
from app.database.outbox_repository import OutboxRepository
from app.database.mongo import collections
from app.messaging.event_dispatcher import EventDispatcher
from app.services.orchestration.handle_event_service import HandleEventService
from app.database.analysis_repository import AnalysisRepository
from app.database.moderation_repository import ModerationRepository
from app.database.task_repository import TaskRepository
from app.processors.retry_worker import RetryWorker
from app.services.ai.model_loader import ensure_models_loaded
from app.services.orchestration.analysis_flow_service import AnalysisFlowService

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)

# -------------------------------------------------------
# INIT SINGLETONS - Now using Motor collections
# -------------------------------------------------------
outbox_repo = OutboxRepository(collections['outbox_events'])
analysis_repo = AnalysisRepository(collections['emotion_aggregates'])
moderation_repo = ModerationRepository(collections['moderation_results'])
task_repo = TaskRepository(collections['analysis_tasks'])

# Inject repositories vào analysis_flow_service
analysis_flow_service = AnalysisFlowService(
    moderation_repo,
    analysis_repo,
)

kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)
processor = OutboxBatchProcessor(outbox_repo, kafka_producer)
retry_worker = RetryWorker(analysis_repo, moderation_repo, task_repo, outbox_repo)

event_service = HandleEventService(analysis_flow_service, analysis_repo, moderation_repo, task_repo, outbox_repo)
dispatcher = EventDispatcher(event_service)

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
        logger.info("=" * 70)
        logger.info("🚀 Analysis Service V2.0 - Starting up...")
        logger.info("=" * 70)

        # 1. Load AI Models FIRST (chặn startup để load models)
        logger.info("[Startup] Step 1/5: Loading AI models...")
        await asyncio.to_thread(ensure_models_loaded)
        logger.info("[Startup] ✅ AI models ready")

        # 2. Kafka Producer
        logger.info("[Startup] Step 2/5: Starting Kafka Producer...")
        await kafka_producer.start()
        logger.info("[Startup] ✅ Kafka Producer started")

        # 3. Kafka Consumer loop
        logger.info("[Startup] Step 3/5: Starting Kafka Consumer...")
        background_tasks.append(
            asyncio.create_task(start_kafka(settings))
        )
        logger.info("[Startup] ✅ Kafka Consumer started")

        # 4. Outbox processor
        logger.info("[Startup] Step 4/5: Starting Outbox Processor...")
        background_tasks.append(
            asyncio.create_task(processor.start(interval_seconds=5))
        )
        logger.info("[Startup] ✅ Outbox Processor started")

        # 5. Retry worker
        logger.info("[Startup] Step 5/5: Starting Retry Worker...")
        background_tasks.append(
            asyncio.create_task(retry_worker.start())
        )
        logger.info("[Startup] ✅ Retry Worker started")

        logger.info("=" * 70)
        logger.info("✅ Analysis Service V2.0 - Fully operational!")
        logger.info("=" * 70)

        yield  # ← FastAPI chạy tại đây

    except Exception as e:
        logger.exception("❌ Lifespan startup failed: %s", e)
        raise

    finally:
        logger.info("=" * 70)
        logger.info("🛑 Analysis Service - Shutting down...")
        logger.info("=" * 70)

        processor.stop()
        retry_worker.stop()

        await kafka_producer.stop()
        logger.info("[Shutdown] Kafka Producer stopped")

        for task in background_tasks:
            task.cancel()

        await asyncio.gather(*background_tasks, return_exceptions=True)
        logger.info("=" * 70)
        logger.info("✅ Analysis Service - Shutdown complete")
        logger.info("=" * 70)
