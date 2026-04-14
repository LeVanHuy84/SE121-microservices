import asyncio
import logging
from time import monotonic
from typing import Any

from app.core.config import settings
from app.services.global_fallback_batch_service import GlobalFallbackBatchService

logger = logging.getLogger(__name__)


class RecommendationStateProcessor:
    def __init__(
        self,
        global_fallback_batch_service: GlobalFallbackBatchService | None = None,
    ):
        self._running = False
        self._last_summary: dict[str, Any] | None = None
        self._last_global_fallback_refresh_monotonic: float | None = None
        self.global_fallback_batch_service = global_fallback_batch_service

    async def start(self, interval_seconds: int = 30):
        self._running = True

        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("Recommendation state processor iteration failed")

            await asyncio.sleep(max(1, interval_seconds))

    async def run_once(self):
        global_fallback_refresh_count = 0
        global_fallback_refreshed = False
        if self._should_refresh_global_fallback_candidates():
            global_fallback_refresh_count = (
                self.global_fallback_batch_service.refresh_candidates()
                if self.global_fallback_batch_service
                else 0
            )
            global_fallback_refreshed = True
            self._last_global_fallback_refresh_monotonic = monotonic()

        summary = {
            "globalFallbackRefreshed": global_fallback_refreshed,
            "globalFallbackRefreshCount": global_fallback_refresh_count,
        }

        if summary != self._last_summary:
            logger.info(
                "Recommendation state summary updated: %s", summary
            )
            self._last_summary = dict(summary)
        else:
            logger.debug(
                "Recommendation state summary unchanged globalFallbackRefreshed=%s",
                global_fallback_refreshed,
            )

    def _should_refresh_global_fallback_candidates(self) -> bool:
        if self.global_fallback_batch_service is None:
            return False

        now_monotonic = monotonic()
        if self._last_global_fallback_refresh_monotonic is None:
            return True

        elapsed_seconds = (
            now_monotonic - self._last_global_fallback_refresh_monotonic
        )
        return (
            elapsed_seconds
            >= settings.RECOMMENDATION_GLOBAL_FALLBACK_REFRESH_INTERVAL_SECONDS
        )

    def stop(self):
        self._running = False

    def get_last_summary(self) -> dict[str, Any] | None:
        return dict(self._last_summary) if self._last_summary else None
