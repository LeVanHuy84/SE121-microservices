import logging

from fastapi import APIRouter, Depends
from fastapi import Query

from app.core.security import verify_internal_key
from app.models.rerank_request import (
    PrecomputedRecommendationCandidateOutput,
    RecommendationEmbeddingOutput,
    RecommendationEmbeddingRequest,
    RecommendationRerankRequest,
)
from app.processors.recommendation_state_processor import state_repository
from app.services.model_loader import model_loader
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


@recommend_router.post("/embed", dependencies=[Depends(verify_internal_key)])
def embed_profile_texts(req: RecommendationEmbeddingRequest):
    entity_ids = [item.entityId for item in req.items if item.entityId]
    embeddings = model_loader.encode_profile_texts(
        [item.profileText or "" for item in req.items if item.entityId]
    )
    rows = [
        RecommendationEmbeddingOutput(entityId=entity_id, embedding=embedding)
        for entity_id, embedding in zip(entity_ids, embeddings)
    ]

    logger.info(
        "Recommendation embed completed: requested=%s embedded=%s",
        len(req.items),
        sum(1 for row in rows if row.embedding),
    )
    return {
        "success": True,
        "data": {
            "model": rerank_service.get_runtime_metadata(),
            "embeddings": rows,
        },
    }


@recommend_router.get(
    "/precomputed/{viewer_id}",
    dependencies=[Depends(verify_internal_key)],
)
def get_precomputed_candidates(
    viewer_id: str,
    limit: int = Query(default=20, ge=1, le=100),
):
    snapshot = state_repository.get_precomputed_snapshot(viewer_id, limit)
    if snapshot is None:
        return {
            "success": True,
            "data": {
                "viewerId": viewer_id,
                "generatedAt": None,
                "generationReason": None,
                "modelName": None,
                "candidateCount": 0,
                "candidates": [],
            },
        }

    return {
        "success": True,
        "data": {
            **snapshot,
            "candidates": [
                PrecomputedRecommendationCandidateOutput(**candidate)
                for candidate in snapshot["candidates"]
            ],
        },
    }
