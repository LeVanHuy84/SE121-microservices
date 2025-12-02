from typing import List, Optional
from pydantic import BaseModel, HttpUrl

class PostRequest(BaseModel):
    postId: Optional[int] = None
    content: str
    imageUrls: Optional[List[HttpUrl]] = None
