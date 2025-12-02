from pydantic import BaseModel, HttpUrl
from typing import List, Optional


class TextRequest(BaseModel):
    text: str

class AnalyzeRequest(BaseModel):
    postId: Optional[int] = None
    images: List[HttpUrl]