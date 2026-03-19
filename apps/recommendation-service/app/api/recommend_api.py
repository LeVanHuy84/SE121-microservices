from fastapi import APIRouter, Depends

from app.core.security import verify_internal_key
from app.models.rerank_request import RecommendationRerankRequest
from app.services.rerank_service import rerank_service

recommend_router = APIRouter(prefix="/recommend")


@recommend_router.post("/rerank", dependencies=[Depends(verify_internal_key)])
async def rerank_candidates(req: RecommendationRerankRequest):
    scores = rerank_service.rerank(req)
    return {
        "success": True,
        "data": {
            "scores": scores,
        },
    }


@recommend_router.post("/friends", dependencies=[Depends(verify_internal_key)])
async def recommend_friends(req: RecommendationRerankRequest):
    recommendations = rerank_service.recommend(req)
    return recommendations
