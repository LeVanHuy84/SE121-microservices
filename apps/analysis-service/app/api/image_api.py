from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter
from app.models.analyze_response import ImageEmotion
from app.services.emotion_detector import analyze_multiple_image_urls
from fastapi import HTTPException
from typing import List
from pydantic import BaseModel, HttpUrl

image_router = APIRouter()

@image_router.post("/analyze_images")
async def analyze_images(images: List[HttpUrl]):
    if not images:
        raise HTTPException(status_code=400, detail="images list is empty")

    # chạy hàm sync trong threadpool
    results = await run_in_threadpool(
        analyze_multiple_image_urls,
        [str(u) for u in req.images]
    )

    images_out = []
    for r in results:
        if r.get("error"):
            images_out.append(
                ImageEmotion(
                    url=r.get("url"),
                    error=r.get("error")
                )
            )
        else:
            images_out.append(r)

    return {
        "success": True,
        "data": images_out
    }
