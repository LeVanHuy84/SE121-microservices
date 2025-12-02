from fastapi import APIRouter
from app.models.analyze_request import TextRequest
from app.services.text_classifier import text_classifier

text_router = APIRouter()

@text_router.post("/sentiment")
async def analyze_sentiment(req: TextRequest):
    result = text_classifier.classify_emotion(req.text)
    return {
        "success": True,
        "data": result
    }
