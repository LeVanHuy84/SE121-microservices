import logging

from fastapi import APIRouter, Depends, HTTPException

from app.bootstrap import recommendation_query_service
from app.core.security import verify_internal_key
from app.core.config import settings
from app.models.rerank_request import (
    RecommendationQueryOutput,
    RecommendationQueryRequest,
)
from app.services.model_loader import model_loader
from app.services.query_cache import query_cache

recommend_router = APIRouter(prefix="/recommend")
logger = logging.getLogger("uvicorn.error")


def ensure_model_ready():
    readiness = model_loader.get_readiness_status()
    if readiness["ready"] is not True:
        if settings.RECOMMENDATION_ALLOW_DEGRADED_QUERY:
            logger.warning(
                "Recommendation model not ready; serving degraded results: %s",
                readiness,
            )
            return

        raise HTTPException(status_code=503, detail=readiness)


@recommend_router.post(
    "/query",
    dependencies=[Depends(verify_internal_key), Depends(ensure_model_ready)],
)
def query_candidates(req: RecommendationQueryRequest):
    response = RecommendationQueryOutput.model_validate(
        recommendation_query_service.query(req)
    )
    logger.info(
        (
            "Recommendation query completed: viewerId=%s limit=%s cursor=%s "
            "source=%s returned=%s nextCursor=%s hasNextPage=%s"
        ),
        req.viewerId,
        req.limit,
        req.cursor,
        response.source,
        response.candidateCount,
        response.nextCursor,
        response.hasNextPage,
    )
    return {
        "success": True,
        "data": response,
    }


@recommend_router.get(
    "/query-cache",
    dependencies=[Depends(verify_internal_key)],
)
def get_query_cache_stats():
    return {
        "success": True,
        "data": query_cache.get_stats(),
    }
