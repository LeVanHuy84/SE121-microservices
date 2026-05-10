from __future__ import annotations

from app.memory.session_memory import SessionMemory, session_memory
from app.services.history_store import HistoryStore, history_store


class ClearHistoryCommand:
    def __init__(
        self,
        store: HistoryStore | None = None,
        memory: SessionMemory | None = None,
    ):
        self.store = store or history_store
        self.memory = memory or session_memory

    async def execute(self, user_id: str) -> int:
        deleted_count = await self.store.clear_history_by_user(user_id)
        self.memory.clear_session(f"{user_id}:default")
        return deleted_count
