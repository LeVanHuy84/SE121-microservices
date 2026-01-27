from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import List, Dict, Union

from app.services.ai.image_emotion.image_emotion_analyzer import (
    analyze_multiple_image_urls
)

image_router = APIRouter(prefix="/image", tags=["Image Analysis"])


# =============================================================================
# Request DTO
# =============================================================================

class ImagesRequest(BaseModel):
    images: List[HttpUrl]


# =============================================================================
# Response DTOs
# =============================================================================

class ImageEmotionSuccess(BaseModel):
    url: str
    dominant_emotion: str
    emotion_scores: Dict[str, float]
    confidence: float
    face_count: int
    source: str          # FER | CLIP
    scene_type: str


class ImageEmotionError(BaseModel):
    url: str
    error: str
    retryable: bool | None = None


ImageEmotionResponse = Union[ImageEmotionSuccess, ImageEmotionError]


class AnalyzeImagesResponse(BaseModel):
    success: bool
    data: List[ImageEmotionResponse]


# =============================================================================
# API Endpoint
# =============================================================================

@image_router.post(
    "/analyze_images",
    response_model=AnalyzeImagesResponse
)
async def analyze_images(req: ImagesRequest):
    if not req.images:
        raise HTTPException(
            status_code=400,
            detail="images list is empty"
        )

    results = await analyze_multiple_image_urls(
        [str(url) for url in req.images]
    )

    images_out: List[ImageEmotionResponse] = []

    for r in results:
        # ---------------------------------------------------------------------
        # Error case
        # ---------------------------------------------------------------------
        if r.get("error"):
            images_out.append(
                ImageEmotionError(
                    url=r.get("url"),
                    error=r.get("error"),
                    retryable=r.get("retryable", False)
                )
            )
            continue

        # ---------------------------------------------------------------------
        # Success case (NO LOGIC, ONLY MAPPING)
        # ---------------------------------------------------------------------
        source = r["finalSource"]

        if source == "FER":
            emotion_scores = r["faceEmotion"]["scores"]
            face_count = r["faceEmotion"]["faceCount"]
        else:
            emotion_scores = r["sceneEmotion"]["scores"]
            face_count = 0

        images_out.append(
            ImageEmotionSuccess(
                url=r["url"],
                dominant_emotion=r["finalEmotion"],
                emotion_scores=emotion_scores,
                confidence=r["finalConfidence"],
                face_count=face_count,
                source=source,
                scene_type=r.get("sceneType", "unknown")
            )
        )

    return AnalyzeImagesResponse(
        success=True,
        data=images_out
    )
