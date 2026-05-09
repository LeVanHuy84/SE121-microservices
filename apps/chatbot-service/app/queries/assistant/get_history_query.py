from __future__ import annotations

from datetime import datetime

from app.schemas.assistant_schema import AssistantHistoryPageData
from app.services.chat_history_service import ChatHistoryService, chat_history_service


class GetHistoryQuery:
    def __init__(self, history_service: ChatHistoryService | None = None):
        self.history_service = history_service or chat_history_service

    async def execute(
        self,
        user_id: str,
        page_size: int | None = None,
        before_created_at: datetime | None = None,
        before_id: str | None = None,
    ) -> AssistantHistoryPageData:
        return await self.history_service.get_messages_page_by_user(
            user_id=user_id,
            page_size=page_size,
            before_created_at=before_created_at,
            before_id=before_id,
        )

