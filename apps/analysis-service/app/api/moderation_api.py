from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Dict
import logging

from app.services.ai.text_moderation import moderation_aggregator
from app.services.ai.image_moderation.image_moderator import (
    moderate_multiple_image_urls,
)

logger = logging.getLogger(__name__)

moderation_router = APIRouter(
    prefix="/moderation",
    tags=["moderation"],
)

# ==================================================
# TEXT API (UNCHANGED)
# ==================================================

class TextModerationRequest(BaseModel):
    text: str = Field(..., min_length=1)


class TextModerationResponse(BaseModel):
    is_violation: bool
    confidence: float
    source: str


@moderation_router.post(
    "/check",
    response_model=TextModerationResponse,
)
async def check_text(request: TextModerationRequest):
    result = moderation_aggregator.moderate(request.text)
    return {
        "is_violation": result["is_violation"],
        "confidence": result["confidence"],
        "source": result["source"],
    }


# ==================================================
# IMAGE API (FIXED)
# ==================================================

class ImageModerationRequest(BaseModel):
    urls: List[str] = Field(..., min_items=1)


class UnsafeSceneDetails(BaseModel):
    is_unsafe: bool
    category: str
    confidence: float
    signal_strength: str
    model: str

    # 🔥 FIX QUAN TRỌNG: nested scores
    scores: Optional[Dict[str, Dict[str, float]]] = None


class ImageModerationResult(BaseModel):
    url: str

    is_violation: bool
    severity: Literal["none", "weak", "medium", "high"]
    violations: List[str]
    safe: bool

    unsafe_details: Optional[UnsafeSceneDetails] = None

    error: Optional[str] = None
    retryable: Optional[bool] = None


@moderation_router.post(
    "/images/check",
    response_model=List[ImageModerationResult],
)
async def check_images(request: ImageModerationRequest):
    results = await moderate_multiple_image_urls(request.urls)
    return results
