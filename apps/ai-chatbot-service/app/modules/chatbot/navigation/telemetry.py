from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from collections.abc import Coroutine, Iterable
from datetime import datetime, timezone
from typing import Any

from app.core.database import get_database
from app.modules.chatbot.navigation.catalog import destination_catalog
from app.modules.chatbot.schemas import NavigateAction

logger = logging.getLogger("uvicorn.error")

_EVENTS_COLLECTION = "assistant_intent_events"


def hash_user_id(user_id: str) -> str:
    return hashlib.sha256((user_id or "anonymous").encode("utf-8")).hexdigest()[:16]


class IntentTelemetryService:
    """Records anonymous navigation-offer events and the clicks that follow them.

    Data minimization: events hold only a hashed user id, the offered action/destination ids and the
    resolver path. No message text (raw or tokenized) is ever stored.
    """

    def __init__(self) -> None:
        # Strong references: the event loop only keeps weak references to running tasks.
        self._pending: set[asyncio.Task[None]] = set()

    def track_offer(
        self,
        user_id: str,
        actions: Iterable[NavigateAction],
        resolver_path: str,
    ) -> None:
        """Schedule recording of an offer; never blocks or raises into the chat flow."""
        actions = list(actions)
        if not actions:
            return
        doc = {
            "id": str(uuid.uuid4()),
            "user_id_hash": hash_user_id(user_id),
            "action_ids": [action.id for action in actions],
            "destination_ids_offered": [action.payload.destinationId for action in actions],
            "resolver_path": resolver_path,
            "clicked": False,
            "clicked_action_id": None,
            "clicked_destination_id": None,
            "clicked_at": None,
            "created_at": datetime.now(timezone.utc),
        }
        self._spawn(self._insert_event(doc))

    async def record_action_click(
        self,
        user_id: str,
        action_id: str,
        destination_id: str,
    ) -> bool:
        """Mark the offer that contained `action_id` as clicked. Returns True if an event was updated."""
        if destination_catalog.get(destination_id) is None:
            return False
        try:
            res = await get_database()[_EVENTS_COLLECTION].update_one(
                {
                    "user_id_hash": hash_user_id(user_id),
                    "action_ids": action_id,
                    "clicked": False,
                },
                {
                    "$set": {
                        "clicked": True,
                        "clicked_action_id": action_id,
                        "clicked_destination_id": destination_id,
                        "clicked_at": datetime.now(timezone.utc),
                    }
                },
            )
            return res.modified_count > 0
        except Exception as exc:
            logger.warning("[Telemetry] Failed to record action click: %s", exc)
            return False

    async def get_stats(self) -> dict[str, Any]:
        """Aggregate summary stats from assistant_intent_events collection."""
        try:
            db = get_database()
            col = db[_EVENTS_COLLECTION]
            total_offers = await col.count_documents({})
            total_clicks = await col.count_documents({"clicked": True})
            ctr = round((total_clicks / max(total_offers, 1)) * 100, 2)
            return {
                "total_offers": total_offers,
                "total_clicks": total_clicks,
                "ctr_percentage": ctr,
            }
        except Exception as exc:
            logger.warning("[Telemetry] Failed to aggregate telemetry stats: %s", exc)
            return {
                "total_offers": 0,
                "total_clicks": 0,
                "ctr_percentage": 0.0,
            }

    def _spawn(self, coro: Coroutine[Any, Any, None]) -> None:
        try:
            task = asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            coro.close()
            return
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _insert_event(self, doc: dict[str, Any]) -> None:
        try:
            await get_database()[_EVENTS_COLLECTION].insert_one(doc)
        except Exception as exc:
            logger.debug("[Telemetry] Mongo insert event warning: %s", exc)


intent_telemetry = IntentTelemetryService()
