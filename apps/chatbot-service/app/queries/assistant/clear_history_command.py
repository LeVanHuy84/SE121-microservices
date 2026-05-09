from __future__ import annotations

from app.memory.session_memory import SessionMemory, session_memory
from app.services.chat_history_service import ChatHistoryService, chat_history_service


class ClearHistoryCommand:
    def __init__(
        self,
        history_service: ChatHistoryService | None = None,
        memory: SessionMemory | None = None,
    ):
        self.history_service = history_service or chat_history_service
        self.memory = memory or session_memory

    async def execute(self, user_id: str) -> int:
        deleted_count = await self.history_service.clear_history_by_user(user_id)
        self.memory.clear_session(f"{user_id}:default")
        return deleted_count

