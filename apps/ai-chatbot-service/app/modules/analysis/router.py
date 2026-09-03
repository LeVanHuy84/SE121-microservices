from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
import logging
import time

from app.core.security import verify_internal_key
from app.modules.analysis.schemas import (
    ImagesRequest,
    TextModerationRequest,
    TextModerationResponse,
    ImageModerationRequest,
    ImageModerationResult,
)
from app.modules.analysis.lifespan import event_service, analysis_flow_service, get_model_health
from app.modules.analysis.services.orchestration.music_flow_service import music_flow_service
from app.modules.analysis.services.ml_models.text_emotion.text_emotion_classifier import text_emotion_classifier
from app.modules.analysis.services.ml_models.text_moderation import moderation_aggregator
from app.modules.analysis.services.ml_models.vlm import vlm_analyzer

logger = logging.getLogger(__name__)

# routers
health_router = APIRouter()
music_router = APIRouter(prefix="/musics", dependencies=[Depends(verify_internal_key)])
test_router = APIRouter(prefix="/test", tags=["Test Analysis"])
image_router = APIRouter(prefix="/image", tags=["Image Analysis"])
moderation_router = APIRouter(prefix="/moderation", tags=["moderation"])

# health
startup_time = time.time()

@health_router.get("/health")
async def health_check():
    uptime_seconds = int(time.time() - startup_time)
    model_health = get_model_health()
    all_loaded = (
        model_health.get("initialized", False) and
        model_health.get("text_emotion", False)
    )
    return {
        "status": "healthy" if all_loaded else "initializing",
        "version": "3.0.0",
        "models": {
            "initialized": model_health.get("initialized", False),
            "text_emotion": "loaded" if model_health.get("text_emotion", False) else "not_loaded",
            "text_moderation": "loaded" if model_health.get("text_moderation", False) else "not_loaded",
            "vlm_multimodal": "loaded" if model_health.get("vlm_multimodal", False) else "not_loaded",
        },
        "uptime_seconds": uptime_seconds,
        "ready": all_loaded
    }

@health_router.get("/")
async def root():
    return {
        "service": "Analysis Service",
        "version": "3.0.0",
        "status": "running"
    }

# music
class MusicUrlRequest(BaseModel):
    url: str

@music_router.post("/analyze")
async def analyze_music_from_url(req: MusicUrlRequest):
    try:
        result = music_flow_service.analyze_from_url(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"success": True, "result": result}

# test
class SentimentRequest(BaseModel):
    text: str

@test_router.post("/text/sentiment")
async def analyze_sentiment(req: SentimentRequest):
    result = text_emotion_classifier.classify(req.text)
    return {"success": True, "data": result}

class TestPostRequest(BaseModel):
    userId: str
    targetId: str
    targetType: str
    content: str
    imageUrls: List[str] = []

@test_router.post("/post")
async def test_created(req: TestPostRequest):
    event = {
        "userId": req.userId,
        "targetId": req.targetId,
        "targetType": req.targetType,
        "content": req.content,
        "imageUrls": req.imageUrls
    }
    result = await event_service.handle_created(event)
    return {"success": True, "result": result}

class UpdatePostRequest(BaseModel):
    userId: str
    targetId: str
    targetType: str
    content: str

@test_router.post("/update-post")
async def test_updated(req: UpdatePostRequest):
    event = {
        "userId": req.userId,
        "targetId": req.targetId,
        "targetType": req.targetType,
        "content": req.content
    }
    result = await event_service.handle_updated(event)
    return {"success": True, "result": result}

class TestRequest(BaseModel):
    content: str
    imageUrls: List[str] = []
    targetType: str

@test_router.post("/before_save")
async def test_before_save(req: TestRequest):
    result = await analysis_flow_service.analyze_content(
        text=req.content,
        image_urls=req.imageUrls,
        target_type=req.targetType
    )
    return {"success": True, "result": result}

@test_router.post("/music/from-url")
async def test_music_from_url(req: MusicUrlRequest):
    try:
        result = music_flow_service.analyze_from_url(req.url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"success": True, "result": result}

# image
@image_router.post("/analyze_images")
async def analyze_images(req: ImagesRequest):
    urls = [str(url) for url in req.images]
    results = vlm_analyzer.analyze_post(text_content="", image_inputs=urls)
    return {"success": True, "data": results}

# moderation
@moderation_router.post("/check", response_model=TextModerationResponse)
async def check_text(request: TextModerationRequest):
    result = moderation_aggregator.moderate(request.text)
    return {
        "is_violation": result["is_violation"],
        "confidence": result["confidence"],
        "source": result["source"],
    }

@moderation_router.post("/images/check", response_model=List[ImageModerationResult])
async def check_images(request: ImageModerationRequest):
    results = vlm_analyzer.analyze_post(text_content="", image_inputs=request.urls)
    mod = results.get("contentModeration", {})
    is_violation = bool(mod.get("is_flagged", False))
    score = float(mod.get("confidence", 0.95)) if is_violation else 0.0

    return [{
        "url": url,
        "is_violation": is_violation,
        "confidence": score,
        "source": "vlm_groq"
    } for url in request.urls]
