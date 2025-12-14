from pydantic import BaseModel, HttpUrl
from typing import List, Optional

class CreateAnalyzeRequest(BaseModel):
    userId: str
    targetId: str
    targetType: str
    content: str
    imageUrls: Optional[List[HttpUrl]] = None

class UpdateAnalyzeRequest(BaseModel):
    targetId: str
    targetType: str
    content: Optional[str] = None

class EmotionQuery(BaseModel):
    userId: str
    targetId: str
    targetType: str
    from_date: Optional[str] = None
    to_date: Optional[str] = None
