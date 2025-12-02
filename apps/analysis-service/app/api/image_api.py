from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter
from app.models.analyze_request import AnalyzeRequest
from app.models.analyze_response import AnalyzeResponse, ImageEmotion
from app.services.emotion_detector import analyze_multiple_image_urls
from fastapi import HTTPException

image_router = APIRouter()

@image_router.post("/analyze_images", response_model=AnalyzeResponse)
async def analyze_images(req: AnalyzeRequest):
    if not req.images:
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
            images_out.append(
                ImageEmotion(
                    url=r.get("url"),
                    dominant_emotion=r.get("dominant_emotion"),
                    emotion_scores=r.get("emotion_scores")
                )
            )

    return AnalyzeResponse(
        postId=req.postId,
        images=images_out
    )
