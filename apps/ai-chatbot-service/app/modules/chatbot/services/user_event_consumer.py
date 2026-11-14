from __future__ import annotations

import logging
from typing import Any

from app.modules.chatbot.repositories.chat_history import HistoryStore, history_store

logger = logging.getLogger("uvicorn.error")


async def handle_user_event(msg: dict[str, Any], store: HistoryStore | None = None) -> None:
    if not isinstance(msg, dict):
        return

    payload = msg.get("payload")
    payload_dict = payload if isinstance(payload, dict) else {}

    event_type = (
        msg.get("eventType")
        or msg.get("type")
        or payload_dict.get("eventType")
        or payload_dict.get("type")
    )

    if event_type == "user.removed":
        user_id = payload_dict.get("userId") or msg.get("userId")
        if user_id:
            logger.info("[UserConsumer] Processing user.removed event for userId=%s", user_id)
            active_store = store or history_store
            try:
                deleted_count = await active_store.purge_user_data(
                    user_id=str(user_id),
                    include_emotion_cache=True,
                )
                logger.info(
                    "[UserConsumer] Successfully purged chatbot data for userId=%s (deleted %d messages)",
                    user_id,
                    deleted_count,
                )
            except Exception as exc:
                logger.exception("[UserConsumer] Failed to purge chatbot data for userId=%s: %s", user_id, exc)
