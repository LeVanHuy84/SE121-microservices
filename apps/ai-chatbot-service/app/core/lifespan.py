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

    logger.info("=" * 60)
    logger.info("[Startup] AI Chatbot & Analysis Service - Initializing...")
    logger.info("=" * 60)

    # 1. MongoDB Database & Indexes
    db = init_database()
    try:
        await db['emotion_aggregates'].create_index([("userId", 1), ("createdAt", 1)], name="idx_userId_createdAt")
        logger.info("[Startup] ✓ MongoDB connected & indexes verified")
    except Exception as index_exc:
        logger.warning("[Startup] ⚠ MongoDB index verification warning: %s", index_exc)

    # 2. Chatbot History Store
    await history_store.start()
    logger.info("[Startup] ✓ Chatbot history store active")

    # 3. Load AI Analysis Models (PhoBERT + VLM)
    from app.modules.analysis.services.ml_models.model_loader import ensure_models_loaded
    await asyncio.to_thread(ensure_models_loaded)
    logger.info("[Startup] ✓ AI Analysis models loaded & ready")

    # 4. RAG Document Index Warmup
    if settings.RAG_WARMUP_ON_STARTUP:
        from app.modules.chatbot.services.rag_engine import rag_document_service
        rag_warmup_task = asyncio.create_task(rag_document_service.warm_up_async())
        logger.info("[Startup] ✓ RAG document index warmup started")
    else:
        rag_warmup_task = None

    # 5. Kafka & Outbox Messaging Workers
    from app.modules.analysis.lifespan import kafka_producer, processor, retry_worker, start_kafka
    await kafka_producer.start()
    background_tasks.append(asyncio.create_task(start_kafka(settings)))
    background_tasks.append(asyncio.create_task(processor.start(interval_seconds=5)))
    background_tasks.append(asyncio.create_task(retry_worker.start()))
    logger.info("[Startup] ✓ Kafka Consumer/Producer & Outbox workers running")

    logger.info("=" * 60)
    logger.info("[Startup] AI Chatbot & Analysis Service - Fully operational!")
    logger.info("=" * 60)

    try:
        yield
    finally:
        logger.info("[Shutdown] Shutting down AI Chatbot & Analysis Service...")
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
        logger.info("[Shutdown] Cleanup complete. Shutdown successful.")
