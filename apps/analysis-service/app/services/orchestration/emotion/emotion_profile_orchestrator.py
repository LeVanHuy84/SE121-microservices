"""Emotion profile orchestration for daily batch updates only."""

from datetime import datetime, timezone


class EmotionProfileOrchestrator:
    """
    Updates long-term user emotion profile once per day from yesterday's aggregates.
    """

    def __init__(self, profile_service, profile_repository):
        self.profile_service = profile_service
        self.profile_repo = profile_repository

    async def upsert_daily_profile(
        self,
        user_id: str,
        yesterday_aggregates: list[dict],
    ) -> dict:
        """
        Compute yesterday distribution and apply EMA to profile.
        """
        now = datetime.now(timezone.utc)
        current_distribution = self.profile_service.compute_distribution_from_aggregates(
            yesterday_aggregates
        )

        profile = await self.profile_repo.get_by_user_id(user_id)
        if profile:
            previous_ema = profile.get("emotionVectorEMA", {})
            updated_ema = self.profile_service.apply_ema(previous_ema, current_distribution)
            return await self.profile_repo.upsert(
                user_id=user_id,
                data={
                    "userId": user_id,
                    "emotionVectorEMA": updated_ema,
                    "lastUpdated": now,
                },
            )

        return await self.profile_repo.create(
            {
                "userId": user_id,
                "emotionVectorEMA": current_distribution,
                "lastUpdated": now,
            }
        )