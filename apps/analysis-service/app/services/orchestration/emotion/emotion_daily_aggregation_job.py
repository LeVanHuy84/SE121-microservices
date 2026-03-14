"""Daily batch job for profile EMA + 7d/30d snapshot recomputation."""

import asyncio
import logging
from datetime import datetime, time, timedelta, timezone

logger = logging.getLogger(__name__)


class EmotionDailyAggregationJob:
    """
    Runs once per day at 00:05 UTC.

    Workflow per dirty user:
    1. Compute yesterday distribution and update profile EMA.
    2. Recompute 7d and 30d snapshots.
    3. Remove user from dirty set after successful processing.
    """

    def __init__(
        self,
        snapshot_queue_service,
        emotion_profile_orchestrator,
        emotion_snapshot_orchestrator,
        emotion_aggregate_repository,
        run_hour: int = 0,
        run_minute: int = 5,
    ):
        self.snapshot_queue_service = snapshot_queue_service
        self.profile_orchestrator = emotion_profile_orchestrator
        self.snapshot_orchestrator = emotion_snapshot_orchestrator
        self.aggregate_repository = emotion_aggregate_repository
        self.run_hour = run_hour
        self.run_minute = run_minute
        self._running = False

    async def run(self) -> None:
        self._running = True
        logger.info(
            "EmotionDailyAggregationJob started (daily at %02d:%02d UTC)",
            self.run_hour,
            self.run_minute,
        )

        while self._running:
            wait_seconds = self._seconds_until_next_run(datetime.now(timezone.utc))
            await asyncio.sleep(wait_seconds)

            if not self._running:
                break

            await self.run_once()

    def stop(self) -> None:
        self._running = False

    async def run_once(self, now: datetime | None = None) -> dict:
        if now is None:
            now = datetime.now(timezone.utc)

        yesterday_start, yesterday_end = self._yesterday_range(now)
        dirty_users = await self.snapshot_queue_service.get_dirty_users()
        users = sorted(dirty_users) if dirty_users else []

        if not users:
            logger.info("EmotionDailyAggregationJob: no dirty users")
            return {
                "success": True,
                "usersProcessed": 0,
                "errors": 0,
            }

        logger.info("EmotionDailyAggregationJob: processing %s users", len(users))

        processed = 0
        errors = 0

        for user_id in users:
            try:
                yesterday_aggregates = await self.aggregate_repository.get_by_user_in_date_range(
                    user_id=user_id,
                    start_time=yesterday_start,
                    end_time=yesterday_end,
                )

                await self.profile_orchestrator.upsert_daily_profile(
                    user_id=user_id,
                    yesterday_aggregates=yesterday_aggregates,
                )

                await self.snapshot_orchestrator.recompute_user_snapshots(
                    user_id=user_id,
                    reference_time=now,
                )

                await self.snapshot_queue_service.remove_user(user_id)
                processed += 1
            except Exception as exc:
                errors += 1
                logger.error(
                    "EmotionDailyAggregationJob failed for user %s: %s",
                    user_id,
                    exc,
                    exc_info=True,
                )

        logger.info(
            "EmotionDailyAggregationJob completed: processed=%s errors=%s",
            processed,
            errors,
        )

        return {
            "success": errors == 0,
            "usersProcessed": processed,
            "errors": errors,
        }

    def _seconds_until_next_run(self, now: datetime) -> float:
        target_today = datetime.combine(
            now.date(),
            time(hour=self.run_hour, minute=self.run_minute, tzinfo=timezone.utc),
        )
        if now < target_today:
            next_run = target_today
        else:
            next_run = target_today + timedelta(days=1)
        return max(1.0, (next_run - now).total_seconds())

    def _yesterday_range(self, now: datetime) -> tuple[datetime, datetime]:
        yesterday = (now - timedelta(days=1)).date()
        start = datetime.combine(yesterday, time.min, tzinfo=timezone.utc)
        end = datetime.combine(yesterday, time.max, tzinfo=timezone.utc)
        return start, end
