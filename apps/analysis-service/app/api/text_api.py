from fastapi import APIRouter
from app.services.text_classifier import text_classifier

text_router = APIRouter()



@text_router.post("/sentiment")
async def analyze_sentiment(text: str):
    result = text_classifier.classify_emotion(text)
    return {
        "success": True,
        "data": result
    }
