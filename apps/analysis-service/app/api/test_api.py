from fastapi import APIRouter
from app.services.ai.text_emotion.text_emotion_classifier import text_emotion_classifier
from pydantic import BaseModel
from typing import List
from app.core.lifespan import event_service
from app.services.orchestration.analysis_flow_service import analysis_flow_service

test_router = APIRouter(prefix="/test", tags=["Test Analysis"])

class SentimentRequest(BaseModel):
    text: str

@test_router.post("/text/sentiment")
async def analyze_sentiment(req: SentimentRequest):
    result = text_emotion_classifier.classify(req.text)
    return {
        "success": True,
        "data": result
    }

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

    return {
        "success": True,
        "result": result
    }

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

    return {
        "success": True,
        "result": result
    }

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

    return {
        "success": True,
        "result": result
    }

