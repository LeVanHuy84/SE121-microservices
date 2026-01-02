from fastapi import APIRouter
from app.services.text_classifier import text_classifier
from pydantic import BaseModel

text_router = APIRouter()

class SentimentRequest(BaseModel):
    text: str

@text_router.post("/sentiment")
async def analyze_sentiment(req: SentimentRequest):
    result = text_classifier.classify_emotion(req.text)
    return {
        "success": True,
        "data": result
    }
