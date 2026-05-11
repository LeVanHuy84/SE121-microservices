from __future__ import annotations

from app.schemas.assistant_schema import AssistantRespondRequest, AssistantSource
from app.services.history_store import HistoryStore, history_store


class PersistHistoryCommand:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(
        self,
        request: AssistantRespondRequest,
        assistant_reply: str,
        sources: list[AssistantSource],
        intent: str | None,
    ) -> bool:
        if not self.store.is_enabled():
            return False

        return await self.store.enqueue_exchange(
            user_id=request.userId,
            user_message=request.message,
            assistant_reply=assistant_reply,
            intent=intent,
            sources=sources,
            client_message_id=request.clientMessageId,
        )
