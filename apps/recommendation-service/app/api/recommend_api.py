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


from collections import defaultdict
import asyncio

viewer_semaphores: dict[str, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(1))

@recommend_router.post(
    "/query",
    dependencies=[Depends(verify_internal_key), Depends(ensure_model_ready)],
)
async def query_candidates(req: RecommendationQueryRequest):
    viewer_id = str(req.viewerId or "").strip()
    sem = viewer_semaphores[viewer_id]
    
    try:
        async def _run_query():
            async with sem:
                response_data = await asyncio.to_thread(recommendation_query_service.query, req)
                return RecommendationQueryOutput.model_validate(response_data)
        
        response = await asyncio.wait_for(_run_query(), timeout=5.0)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Recommendation query timed out")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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
