from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.modules.chatbot.services.rag_engine import rag_document_service

logger = logging.getLogger("uvicorn.error")


class RagIndexerService:
    def __init__(self):
        self._lock = asyncio.Lock()
        self._is_indexing = False

    @property
    def is_indexing(self) -> bool:
        return self._is_indexing

    async def trigger_reindex(self, force: bool = False) -> dict[str, Any]:
        if self._lock.locked():
            return {
                "status": "in_progress",
                "message": "Reindexing is already running in background",
            }

        async with self._lock:
            self._is_indexing = True
            try:
                result = await rag_document_service.index_assistant_docs(force_reindex=force)
                logger.info("[RAG Indexer] Reindex completed: %s", result)
                return {
                    "status": "completed",
                    "result": result,
                }
            except Exception as exc:
                logger.exception("[RAG Indexer] Reindex failed: %s", exc)
                return {
                    "status": "failed",
                    "error": str(exc),
                }
            finally:
                self._is_indexing = False


rag_indexer_service = RagIndexerService()
