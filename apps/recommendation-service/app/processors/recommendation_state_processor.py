import asyncio
import logging
from typing import Any

from app.services.graph_state_store import graph_state_store

logger = logging.getLogger(__name__)


class RecommendationStateProcessor:
    def __init__(self):
        self._running = False
        self._last_summary: dict[str, Any] | None = None

    async def start(self, interval_seconds: int = 30):
        self._running = True

        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("Recommendation state processor iteration failed")

            await asyncio.sleep(max(1, interval_seconds))

    async def run_once(self):
        summary = graph_state_store.get_summary()

        if summary != self._last_summary:
            logger.info("Recommendation graph state summary updated: %s", summary)
            self._last_summary = dict(summary)
        else:
            logger.debug("Recommendation graph state summary unchanged")

    def stop(self):
        self._running = False

    def get_last_summary(self) -> dict[str, Any] | None:
        return dict(self._last_summary) if self._last_summary else None


recommendation_state_processor = RecommendationStateProcessor()
