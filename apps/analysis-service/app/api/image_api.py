from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import List, Dict, Union
from app.core.services.image_downloader import image_downloader
from app.services.ai.image_emotion.image_emotion_analyzer import (
    analyze_multiple_images
)

image_router = APIRouter(prefix="/image", tags=["Image Analysis"])


# =============================================================================
# Request DTO
# =============================================================================

class ImagesRequest(BaseModel):
    images: List[HttpUrl]

# =============================================================================
# API Endpoint
# =============================================================================

@image_router.post(
    "/analyze_images",
)
async def analyze_images(req: ImagesRequest):
    

    image_inputs = await image_downloader.download([str(url) for url in req.images])

    results = await analyze_multiple_images(image_inputs)

    return {
        "success": True,
        "data": results
    }
