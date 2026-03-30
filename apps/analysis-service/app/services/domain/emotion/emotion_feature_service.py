from datetime import datetime, timedelta, timezone
from motor.motor_asyncio import AsyncIOMotorCollection

from app.database.emotion_aggregate_repository import EmotionAggregateRepository
from app.enums.emotion_enum import EmotionTimeWindowEnum

_NEUTRAL_DISTRIBUTION: dict[str, float] = {
    "joy": 0.1,
    "sadness": 0.1,
    "anger": 0.1,
    "fear": 0.1,
    "disgust": 0.1,
    "surprise": 0.1,
    "neutral": 0.4,
}


class EmotionFeatureService:
    """
    Assembles emotion ranking features for feed personalization.

    Performs exactly 2 database queries per request:
      Query 1 — MongoDB aggregation pipeline: profiles + snapshots joined.
      Query 2 — Emotion aggregates for the last 24 h.
    """

    def __init__(
        self,
        profile_collection: AsyncIOMotorCollection,
        aggregate_repo: EmotionAggregateRepository,
    ) -> None:
        self._profile_collection = profile_collection
        self._aggregate_repo = aggregate_repo

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_user_emotion_features(self, user_id: str) -> dict:
        """
        Return assembled ranking features for the given user.

        Returns:
            {
                "userId": str,
                "features": {
                    "userEmotionPreference": {emotion: float},
                    "last24hEmotionDistribution": {emotion: float},
                    "negativeRatio7d": float,
                    "emotionVolatility7d": float,
                    "riskScore": float,
                    "negativeStreak": int,
                }
            }
        """
        # ── Query 1: profile + snapshots in one aggregation ──────────────
        profile_doc = await self._fetch_profile_with_snapshots(user_id)

        emotion_vector_ema: dict[str, float] = profile_doc.get("emotionVectorEMA") or _NEUTRAL_DISTRIBUTION
        negative_streak: int = profile_doc.get("negativeStreak") or 0

        snapshot_7d = self._extract_snapshot_7d(profile_doc.get("snapshots") or [])
        negative_ratio_7d: float = snapshot_7d.get("negativeRatio", 0.0) if snapshot_7d else 0.0
        emotion_volatility_7d: float = snapshot_7d.get("emotionVolatility", 0.0) if snapshot_7d else 0.0
        risk_score: float = snapshot_7d.get("riskScore", 0.0) if snapshot_7d else 0.0

        # ── Query 2: last-24 h aggregates ─────────────────────────────────
        now = datetime.now(timezone.utc)
        since_24h = now - timedelta(hours=24)
        aggregates_24h = await self._aggregate_repo.get_by_user_since(
            user_id, since_24h, reference_time=now
        )

        last_24h_distribution = self._compute_24h_distribution(aggregates_24h)

        return {
            "userId": user_id,
            "features": {
                "userEmotionPreference": emotion_vector_ema,
                "last24hEmotionDistribution": last_24h_distribution,
                "negativeRatio7d": negative_ratio_7d,
                "emotionVolatility7d": emotion_volatility_7d,
                "riskScore": risk_score,
                "negativeStreak": negative_streak,
            },
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _fetch_profile_with_snapshots(self, user_id: str) -> dict:
        """
        Single aggregation pipeline: match profile → $lookup snapshots.
        Projects only the fields required for ranking feature assembly.
        """
        pipeline = [
            {"$match": {"userId": user_id}},
            {
                "$lookup": {
                    "from": "user_emotion_snapshots",
                    "localField": "userId",
                    "foreignField": "userId",
                    "as": "snapshots",
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "emotionVectorEMA": 1,
                    "negativeStreak": 1,
                    "snapshots.window": 1,
                    "snapshots.negativeRatio": 1,
                    "snapshots.emotionVolatility": 1,
                    "snapshots.riskScore": 1,
                }
            },
        ]

        cursor = self._profile_collection.aggregate(pipeline)
        results = await cursor.to_list(length=1)

        if results:
            return results[0]

        # Profile not yet created — return safe defaults
        return {"emotionVectorEMA": {}, "negativeStreak": 0, "snapshots": []}

    @staticmethod
    def _extract_snapshot_7d(snapshots: list[dict]) -> dict | None:
        """Return the first snapshot whose window is '7d', or None."""
        target = EmotionTimeWindowEnum.LAST_7_DAYS.value  # "7d"
        return next((s for s in snapshots if s.get("window") == target), None)

    @staticmethod
    def _compute_24h_distribution(aggregates: list[dict]) -> dict[str, float]:
        """
        Derive an emotion distribution from the last-24 h aggregates.

        Each aggregate contributes its ``finalScores`` dict.
        All scores are summed per emotion then normalised so the result
        sums to 1.0.  Returns a neutral distribution when no data is
        available.
        """
        if not aggregates:
            return dict(_NEUTRAL_DISTRIBUTION)

        totals: dict[str, float] = {}
        for agg in aggregates:
            scores: dict = agg.get("finalScores") or {}
            for emotion, score in scores.items():
                totals[emotion] = totals.get(emotion, 0.0) + float(score)

        grand_total = sum(totals.values())
        if grand_total == 0.0:
            return dict(_NEUTRAL_DISTRIBUTION)

        return {emotion: value / grand_total for emotion, value in totals.items()}
