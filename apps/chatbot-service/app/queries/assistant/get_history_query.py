from __future__ import annotations

from datetime import datetime

from app.schemas.assistant_schema import AssistantHistoryPageData
from app.services.history_store import HistoryStore, history_store


class GetHistoryQuery:
    def __init__(self, store: HistoryStore | None = None):
        self.store = store or history_store

    async def execute(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> AssistantHistoryPageData:
        return await self.store.get_messages_page_by_user(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
        )
