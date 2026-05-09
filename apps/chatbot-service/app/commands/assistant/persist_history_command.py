from __future__ import annotations

import asyncio
import logging
import time

from app.core.config import settings
from app.schemas.assistant_schema import AssistantRespondRequest, AssistantSource
from app.services.chat_history_service import ChatHistoryService, chat_history_service

logger = logging.getLogger("uvicorn.error")


class PersistHistoryCommand:
    def __init__(self, history_service: ChatHistoryService | None = None):
        self.history_service = history_service or chat_history_service

    async def execute(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ) -> bool:
        if not self.history_service.is_enabled():
            return False

        started_at = time.perf_counter()
        timeout_seconds = max(settings.CHATBOT_HISTORY_PERSIST_TIMEOUT_MS, 1) / 1000
        try:
            await asyncio.wait_for(
                self.history_service.append_exchange(
                    user_id=request.userId,
                    user_message=request.message,
                    assistant_reply=assistant_reply,
                    intent=intent,
                    sources=sources,
                    client_message_id=request.clientMessageId,
                ),
                timeout=timeout_seconds,
            )
            return True
        except Exception:
            logger.exception(
                "Assistant history persistence failed: userId=%s conversationId=%s",
                request.userId,
                request.conversationId,
            )
            return False
        finally:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.debug(
                "assistant.persist_history durationMs=%s userId=%s",
                duration_ms,
                request.userId,
            )
