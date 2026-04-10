import asyncio
import logging
from typing import Any

from app.core.config import settings
from app.services.graph_state_store import RecommendationGraphStateStore
from app.services.precompute_queue import (
    RecommendationPrecomputeQueue,
)
from app.services.precompute_service import RecommendationPrecomputeService

logger = logging.getLogger(__name__)


class RecommendationStateProcessor:
    def __init__(
        self,
        precompute_queue_service: RecommendationPrecomputeQueue,
        precompute_service: RecommendationPrecomputeService,
        graph_state_store: RecommendationGraphStateStore,
    ):
        self._running = False
        self._last_summary: dict[str, Any] | None = None
        self.precompute_queue = precompute_queue_service
        self.precompute_service = precompute_service
        self.graph_state_store = graph_state_store

    async def start(self, interval_seconds: int = 30):
        self._running = True

        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("Recommendation state processor iteration failed")

            await asyncio.sleep(max(1, interval_seconds))

    async def run_once(self):
        summary = self.graph_state_store.get_summary()
        pending_viewer_ids = self.precompute_queue.drain(
            settings.RECOMMENDATION_PRECOMPUTE_BATCH_SIZE
        )

        for viewer_id in pending_viewer_ids:
            self.precompute_service.compute_for_viewer(
                viewer_id,
                generation_reason="state-processor",
            )

        if summary != self._last_summary:
            resolved_summary = {
                **summary,
                "precomputeQueueSize": self.precompute_queue.size(),
                "processedViewers": len(pending_viewer_ids),
            }
            logger.info(
                "Recommendation graph state summary updated: %s", resolved_summary
            )
            self._last_summary = dict(resolved_summary)
        else:
            logger.debug(
                (
                    "Recommendation graph state summary unchanged "
                    "processedViewers=%s queueSize=%s"
                ),
                len(pending_viewer_ids),
                self.precompute_queue.size(),
            )

    def stop(self):
        self._running = False

    def get_last_summary(self) -> dict[str, Any] | None:
        return dict(self._last_summary) if self._last_summary else None
