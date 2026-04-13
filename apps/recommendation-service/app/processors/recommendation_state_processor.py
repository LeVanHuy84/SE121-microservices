import asyncio
import logging
from typing import Any

from app.core.config import settings
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
    ):
        self._running = False
        self._last_summary: dict[str, Any] | None = None
        self.precompute_queue = precompute_queue_service
        self.precompute_service = precompute_service

    async def start(self, interval_seconds: int = 30):
        self._running = True

        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("Recommendation state processor iteration failed")

            await asyncio.sleep(max(1, interval_seconds))

    async def run_once(self):
        queue_size_before = self.precompute_queue.size()
        projection_rows_changed = self.precompute_queue.consume_projection_rows_changed()
        pending_viewer_ids = self.precompute_queue.drain(
            settings.RECOMMENDATION_PRECOMPUTE_BATCH_SIZE
        )

        snapshot_refresh_count = 0
        for viewer_id in pending_viewer_ids:
            self.precompute_service.compute_for_viewer(
                viewer_id,
                generation_reason="state-processor",
            )
            snapshot_refresh_count += 1

        summary = {
            "queueSize": self.precompute_queue.size(),
            "queueSizeBeforeDrain": queue_size_before,
            "processedViewers": len(pending_viewer_ids),
            "projectionRowsChanged": projection_rows_changed,
            "snapshotRefreshCount": snapshot_refresh_count,
        }

        if summary != self._last_summary:
            logger.info(
                "Recommendation state summary updated: %s", summary
            )
            self._last_summary = dict(summary)
        else:
            logger.debug(
                (
                    "Recommendation state summary unchanged "
                    "processedViewers=%s queueSize=%s projectionRowsChanged=%s"
                ),
                len(pending_viewer_ids),
                self.precompute_queue.size(),
                projection_rows_changed,
            )

    def stop(self):
        self._running = False

    def get_last_summary(self) -> dict[str, Any] | None:
        return dict(self._last_summary) if self._last_summary else None
