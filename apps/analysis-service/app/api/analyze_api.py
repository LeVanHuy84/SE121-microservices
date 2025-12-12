from fastapi import APIRouter
from app.models.analyze_request import CreateAnalyzeRequest
from app.models.analyze_response import AnalysisResponse
from app.services.emotion_analyzer import EmotionAnalyzer

analyze_router = APIRouter()

@analyze_router.post("/sentiment", response_model=AnalysisResponse)
async def analyze_sentiment(req: CreateAnalyzeRequest):
    analyzer = EmotionAnalyzer()
    result = analyzer.analyze(req)  # trả về dict như trước

    # Tạo response model
    response = AnalysisResponse(
        userId=req.userId,
        targetId=req.targetId,
        targetType=req.targetType,
        text_emotion=result["text_emotion"],
        image_emotions=result["image_emotions"],
        final_emotion=result["final_emotion"],
        final_scores=result["final_scores"]
    )
    return response
