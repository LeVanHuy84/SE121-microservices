from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Dict

from app.core.security import verify_internal_key
from app.database.mongo import collections
from app.database.emotion_aggregate_repository import EmotionAggregateRepository
from app.services.domain.emotion.emotion_feature_service import EmotionFeatureService

# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------

class EmotionRankingFeatures(BaseModel):
    userEmotionPreference: Dict[str, float]
    last24hEmotionDistribution: Dict[str, float]
    negativeRatio7d: float
    emotionVolatility7d: float
    riskScore: float
    negativeStreak: int


class EmotionRankingFeaturesResponse(BaseModel):
    userId: str
    features: EmotionRankingFeatures


# ---------------------------------------------------------------------------
# Router & service wiring
# ---------------------------------------------------------------------------

emotion_feature_router = APIRouter(
    prefix="/emotion",
    dependencies=[Depends(verify_internal_key)],
)

_aggregate_repo = EmotionAggregateRepository(collections["emotion_aggregates"])
_service = EmotionFeatureService(
    profile_collection=collections["user_emotion_profiles"],
    aggregate_repo=_aggregate_repo,
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@emotion_feature_router.get(
    "/features/{user_id}",
    response_model=EmotionRankingFeaturesResponse,
    summary="Get emotion ranking features for feed personalization",
)
async def get_emotion_ranking_features(user_id: str):
    """
    Returns emotion ranking features assembled from:

    - **Query 1** – MongoDB aggregation pipeline joining `user_emotion_profiles`
      with `user_emotion_snapshots` (single round-trip).
    - **Query 2** – `emotion_aggregates` for the last 24 h, used to compute
      the short-term emotion distribution.

    Total database queries: **2**.
    """
    result = await _service.get_user_emotion_features(user_id)
    return result
