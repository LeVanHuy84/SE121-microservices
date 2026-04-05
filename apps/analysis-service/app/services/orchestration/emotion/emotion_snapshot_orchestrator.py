"""Emotion snapshot orchestration for daily batch recomputation."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.enums.emotion_enum import EmotionTimeWindowEnum

logger = logging.getLogger(__name__)


class EmotionSnapshotOrchestrator:
    """
    Recomputes 7-day and 30-day emotion snapshots.
    """

    def __init__(self, snapshot_service, snapshot_repository, aggregate_repository):
        self.snapshot_service = snapshot_service
        self.snapshot_repo = snapshot_repository
        self.aggregate_repo = aggregate_repository

    async def recompute_user_snapshots(
        self,
        user_id: str,
        reference_time: datetime | None = None,
    ) -> dict[str, Any]:
        if reference_time is None:
            reference_time = datetime.now(timezone.utc)

        try:
            since_30d = reference_time - timedelta(days=30)
            aggregates_30d = await self.aggregate_repo.get_by_user_since(
                user_id=user_id,
                since=since_30d,
                reference_time=reference_time,
            )
            since_7d = reference_time - timedelta(days=7)
            aggregates_7d = []
            for aggregate in aggregates_30d:
                created_at = self._to_utc_datetime(aggregate.get("createdAt"))
                if created_at is not None and created_at >= since_7d:
                    aggregates_7d.append(aggregate)

            snapshot_configs = [
                (EmotionTimeWindowEnum.LAST_7_DAYS, aggregates_7d),
                (EmotionTimeWindowEnum.LAST_30_DAYS, aggregates_30d),
            ]

            snapshots_updated = 0
            for window, aggregates in snapshot_configs:
                # Snapshot payload includes distribution, negativeRatio,
                # emotionVolatility, and riskScore.
                snapshot_data = self.snapshot_service.compute_snapshot(
                    user_id=user_id,
                    window=window,
                    aggregates=aggregates,
                    computed_at=reference_time,
                )
                await self.snapshot_repo.upsert(user_id=user_id, window=window, data=snapshot_data)
                snapshots_updated += 1

            return {
                "success": True,
                "userId": user_id,
                "snapshotsUpdated": snapshots_updated,
            }
        except Exception as exc:
            logger.error(
                "Failed to recompute snapshots for user %s: %s",
                user_id,
                exc,
                exc_info=True,
            )
            return {"success": False, "userId": user_id, "error": str(exc)}

    def _to_utc_datetime(self, value: Any) -> datetime | None:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        if isinstance(value, str):
            candidate = value.strip()
            if candidate.endswith("Z"):
                candidate = f"{candidate[:-1]}+00:00"
            try:
                parsed = datetime.fromisoformat(candidate)
            except ValueError:
                return None
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        return None
