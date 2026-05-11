import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings
from app.db.session import close_db, init_db
from app.services.history_store import history_store

@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    await init_db()
    await history_store.start()
    if settings.RAG_WARMUP_ON_STARTUP:
        from app.services.rag_document_service import rag_document_service

        # Warm up on the same running event loop to avoid cross-loop async client usage.
        rag_warmup_task = asyncio.create_task(rag_document_service.warm_up_async())
    else:
        rag_warmup_task = None
    try:
        yield
    finally:
        if rag_warmup_task is not None and not rag_warmup_task.done():
            rag_warmup_task.cancel()
            await asyncio.gather(rag_warmup_task, return_exceptions=True)
        from app.services.rag_document_service import rag_document_service

        await rag_document_service.close()
        await history_store.stop()
        await close_db()
