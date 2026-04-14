import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.config import settings


def start_background_warmup():
    if not settings.RAG_WARMUP_ON_STARTUP:
        return

    def warm_up_rag():
        from app.services.rag_document_service import rag_document_service

        rag_document_service.warm_up()

    threading.Thread(target=warm_up_rag, daemon=True).start()


@asynccontextmanager
async def lifespan(app: FastAPI):
    del app
    start_background_warmup()
    yield
