import logging

from fastapi import APIRouter, Depends

from app.core.security import verify_internal_key
from app.models.rerank_request import RecommendationRerankRequest
from app.services.rerank_service import rerank_service

recommend_router = APIRouter(prefix="/recommend")
logger = logging.getLogger("uvicorn.error")


@recommend_router.post("/rerank", dependencies=[Depends(verify_internal_key)])
def rerank_candidates(req: RecommendationRerankRequest):
    scores = rerank_service.rerank(req)
    score_summary = ", ".join(
        f"{score.candidateId}:{score.modelScore:.4f}" for score in scores[:5]
    )
    logger.info(
        "Recommendation rerank completed: viewerId=%s requested=%s returned=%s topScores=[%s]",
        req.viewerId,
        len(req.candidates),
        len(scores),
        score_summary,
    )
    return {
        "success": True,
        "data": {
            "model": rerank_service.get_runtime_metadata(),
            "scores": scores,
        },
    }
