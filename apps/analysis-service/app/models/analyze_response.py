# app/models/analyze_response.py
from pydantic import BaseModel
from typing import Dict, List, Optional

class ImageEmotion(BaseModel):
    url: str
    dominant_emotion: Optional[str] = None
    emotion_scores: Optional[Dict[str, float]] = None
    error: Optional[str] = None

class AnalyzeResponse(BaseModel):
    postId: Optional[int] = None
    images: List[ImageEmotion]
