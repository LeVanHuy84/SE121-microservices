# apps/analysis-service/app/api/moderation_api.py

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Optional
from app.services.ai.image_moderation.image_moderator import (
    moderate_multiple_image_urls,
)

from app.services.ai.text_moderation import moderation_aggregator


class ModerationRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ModerationResponse(BaseModel):
    is_violation: bool
    confidence: float
    source: str

class ImageModerationRequest(BaseModel):
    urls: List[str] = Field(..., min_items=1)


class ImageModerationResult(BaseModel):
    url: str
    is_violation: Optional[bool] = None
    severity: Optional[str] = None
    violations: Optional[List[str]] = None
    safe: Optional[bool] = None
    error: Optional[str] = None
    retryable: Optional[bool] = None


class ImageModerationResponse(BaseModel):
    results: List[ImageModerationResult]


moderation_router = APIRouter(
    prefix="/moderation",
    tags=["moderation"],
)


@moderation_router.post(
    "/check",
    response_model=ModerationResponse,
)
async def check_content(request: ModerationRequest):
    """
    Moderation pipeline (binary decision only):
    - Keyword: high-recall signal
    - PhoBERT: binary violation
    - Aggregator: final decision
    """
    result = moderation_aggregator.moderate(request.text)

    return {
        "is_violation": result["is_violation"],
        "confidence": result["confidence"],
        "source": result["source"],
    }

@moderation_router.post(
    "/image",
    response_model=ImageModerationResponse,
)
async def check_images(request: ImageModerationRequest):
    """
    Image moderation pipeline:
    - Download image
    - NSFW detection
    - Violence detection
    - Aggregate result
    """
    results = await moderate_multiple_image_urls(request.urls)

    return {
        "results": results
    }
