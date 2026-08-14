import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.settings import settings
from app.core.database import init_database, close_database
from app.modules.chatbot.repositories.chat_history import history_store

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    background_tasks: list[asyncio.Task] = []

    # 1. MongoDB initialization (indexes & client)
    db = init_database()
    logger.info("[Startup] Step 1/6: MongoDB connected, initializing indexes...")
    try:
        await db['user_emotion_snapshots'].create_index(
            [("userId", 1), ("window", 1)],
            unique=True,
            name="idx_unique_user_window"
        )
        await db['user_emotion_snapshots'].create_index(
            [("userId", 1)],
            name="idx_userId"
        )
        await db['user_emotion_profiles'].create_index(
            [("userId", 1)],
            unique=True,
            name="idx_unique_userId"
        )
        await db['emotion_aggregates'].create_index(
            [("userId", 1), ("createdAt", 1)],
            name="idx_userId_createdAt"
        )
        logger.info("[Startup] MongoDB Indexes verified")
    except Exception as index_exc:
        logger.warning("[Startup] Index verification warning: %s", index_exc)

    # 2. Start chatbot history queue workers
    logger.info("[Startup] Step 2/6: Starting Chatbot history store...")
    await history_store.start()

    # 3. Load ML models (from analysis-service)
    logger.info("[Startup] Step 3/6: Loading AI analysis models...")
    from app.modules.analysis.services.ml_models.model_loader import ensure_models_loaded
    await asyncio.to_thread(ensure_models_loaded)
    logger.info("[Startup] AI analysis models ready")

    # 4. Warm up RAG documents in Elasticsearch
    if settings.RAG_WARMUP_ON_STARTUP:
        logger.info("[Startup] Step 4/6: Warming up RAG document index...")
        from app.modules.chatbot.services.rag_engine import rag_document_service
        rag_warmup_task = asyncio.create_task(rag_document_service.warm_up_async())
    else:
        rag_warmup_task = None

    # 5. Initialize analysis messaging components
    logger.info("[Startup] Step 5/6: Configuring Kafka and Outbox...")
    from app.modules.analysis.lifespan import kafka_producer, processor, retry_worker, start_kafka
    await kafka_producer.start()
    background_tasks.append(asyncio.create_task(start_kafka(settings)))
    background_tasks.append(asyncio.create_task(processor.start(interval_seconds=5)))
    background_tasks.append(asyncio.create_task(retry_worker.start()))
    logger.info("[Startup] Kafka, Outbox & Retry workers running")

    logger.info("[Startup] Step 6/6: Initialization complete!")

    try:
        yield
    finally:
        # Cancel all background tasks
        logger.info("[Shutdown] Shutting down background tasks...")
        if rag_warmup_task is not None and not rag_warmup_task.done():
            rag_warmup_task.cancel()
            await asyncio.gather(rag_warmup_task, return_exceptions=True)
            
        from app.modules.analysis.lifespan import kafka_producer, processor, retry_worker
        processor.stop()
        retry_worker.stop()
        await kafka_producer.stop()

        for task in background_tasks:
            task.cancel()
        await asyncio.gather(*background_tasks, return_exceptions=True)

        from app.modules.chatbot.services.rag_engine import rag_document_service
        await rag_document_service.close()
        await history_store.stop()
        await close_database()
        logger.info("[Shutdown] All connections clean, shutdown complete.")
