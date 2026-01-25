from fastapi import APIRouter
from app.services.ai.text_emotion.text_emotion_classifier import text_emotion_classifier
from pydantic import BaseModel

text_router = APIRouter()

class SentimentRequest(BaseModel):
    text: str

@text_router.post("/sentiment")
async def analyze_sentiment(req: SentimentRequest):
    result = text_emotion_classifier.classify(req.text)
    return {
        "success": True,
        "data": result
    }
