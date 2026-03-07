import asyncio
import logging
from contextlib import asynccontextmanager

from app.core.config import settings
from app.messaging.init_kafka import start_kafka, register_consumer
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.processors.batch_processor import OutboxBatchProcessor
from app.processors.user_emotion_snapshot_cron import UserEmotionSnapshotCron
from app.database.outbox_repository import OutboxRepository
from app.database.mongo import collections, db
from app.messaging.event_dispatcher import EventDispatcher
from app.services.orchestration.handle_event_service import HandleEventService
from app.database.moderation_repository import ModerationRepository
from app.database.task_repository import TaskRepository
from app.processors.retry_worker import RetryWorker
from app.services.ai.model_loader import ensure_models_loaded
from app.services.orchestration.analysis_flow_service import AnalysisFlowService
from app.database.user_emotion_profile_repository import UserEmotionProfileRepository
from app.database.user_emotion_snapshot_repository import UserEmotionSnapshotRepository
from app.database.emotion_aggregate_repository import EmotionAggregateRepository
from app.services.domain.emotion.user_emotion_profile_service import UserEmotionProfileService
from app.services.domain.emotion.user_emotion_snapshot_service import UserEmotionSnapshotService
from app.services.orchestration.emotion.user_emotion_processing_orchestrator import UserEmotionProcessingOrchestrator

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

# User Emotion repositories & services
user_emotion_profile_repo = UserEmotionProfileRepository(collections['user_emotion_profiles'])
user_emotion_snapshot_repo = UserEmotionSnapshotRepository(collections['user_emotion_snapshots'])

# Domain services
user_emotion_profile_service = UserEmotionProfileService()
user_emotion_snapshot_service = UserEmotionSnapshotService()

# Orchestrator (coordinates domain services and repositories)
user_emotion_orchestrator = UserEmotionProcessingOrchestrator(
    profile_service=user_emotion_profile_service,
    snapshot_service=user_emotion_snapshot_service,
    profile_repository=user_emotion_profile_repo,
    snapshot_repository=user_emotion_snapshot_repo,
    aggregate_repository=emotion_aggregate_repo
)

# Inject repositories vào analysis_flow_service
analysis_flow_service = AnalysisFlowService(
    moderation_repo,
    emotion_aggregate_repo
)

kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)
processor = OutboxBatchProcessor(outbox_repo, kafka_producer)
retry_worker = RetryWorker(
    emotion_aggregate_repo,
    moderation_repo,
    task_repo,
    outbox_repo
)

# User Emotion Snapshot Cron (runs every 10 minutes)
user_emotion_snapshot_cron = UserEmotionSnapshotCron(
    orchestrator=user_emotion_orchestrator
)

event_service = HandleEventService(
    analysis_flow_service,
    emotion_aggregate_repo,
    moderation_repo,
    task_repo,
    outbox_repo
)
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
# DATABASE INITIALIZATION
# -------------------------------------------------------
async def init_database():
    """
    Initialize database indexes.
    
    Creates required unique indexes to ensure data integrity:
    - user_emotion_snapshots: (userId, window) unique constraint
    """
    try:
        logger.info("[DB Init] Creating indexes...")
        
        # User Emotion Snapshots: Unique index on (userId, window)
        # Ensures each user has only ONE snapshot per time window (24h, 7d, 30d)
        await db['user_emotion_snapshots'].create_index(
            [("userId", 1), ("window", 1)],
            unique=True,
            name="idx_unique_user_window"
        )
        logger.info("[DB Init] ✅ Created unique index: user_emotion_snapshots(userId, window)")
        
        # Optional: Create index on userId for faster lookups
        await db['user_emotion_snapshots'].create_index(
            [("userId", 1)],
            name="idx_userId"
        )
        logger.info("[DB Init] ✅ Created index: user_emotion_snapshots(userId)")
        
        # Optional: Create index on user_emotion_profiles
        await db['user_emotion_profiles'].create_index(
            [("userId", 1)],
            unique=True,
            name="idx_unique_userId"
        )
        logger.info("[DB Init] ✅ Created unique index: user_emotion_profiles(userId)")
        
        logger.info("[DB Init] ✅ All indexes created successfully")
        
    except Exception as e:
        # Log but don't fail startup if indexes already exist
        logger.warning(f"[DB Init] Index creation warning (may already exist): {e}")

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

        # 0. Database initialization (indexes)
        logger.info("[Startup] Step 0/7: Initializing database indexes...")
        await init_database()
        logger.info("[Startup] ✅ Database indexes ready")

        # 1. Load AI Models FIRST (chặn startup để load models)
        logger.info("[Startup] Step 1/6: Loading AI models...")
        await asyncio.to_thread(ensure_models_loaded)
        logger.info("[Startup] ✅ AI models ready")

        # 2. Kafka Producer
        logger.info("[Startup] Step 2/6: Starting Kafka Producer...")
        await kafka_producer.start()
        logger.info("[Startup] ✅ Kafka Producer started")

        # 3. Kafka Consumer loop
        logger.info("[Startup] Step 3/6: Starting Kafka Consumer...")
        background_tasks.append(
            asyncio.create_task(start_kafka(settings))
        )
        logger.info("[Startup] ✅ Kafka Consumer started")

        # 4. Outbox processor
        logger.info("[Startup] Step 4/6: Starting Outbox Processor...")
        background_tasks.append(
            asyncio.create_task(processor.start(interval_seconds=5))
        )
        logger.info("[Startup] ✅ Outbox Processor started")

        # 5. Retry worker
        logger.info("[Startup] Step 5/6: Starting Retry Worker...")
        background_tasks.append(
            asyncio.create_task(retry_worker.start())
        )
        logger.info("[Startup] ✅ Retry Worker started")

        # 6. User Emotion Snapshot Cron (every 10 minutes)
        logger.info("[Startup] Step 6/6: Starting User Emotion Snapshot Cron...")
        background_tasks.append(
            asyncio.create_task(user_emotion_snapshot_cron.start())
        )
        logger.info("[Startup] ✅ User Emotion Snapshot Cron started (interval: 10min)")

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
        user_emotion_snapshot_cron.stop()

        await kafka_producer.stop()
        logger.info("[Shutdown] Kafka Producer stopped")

        for task in background_tasks:
            task.cancel()

        await asyncio.gather(*background_tasks, return_exceptions=True)
        logger.info("=" * 70)
        logger.info("✅ Analysis Service - Shutdown complete")
        logger.info("=" * 70)
