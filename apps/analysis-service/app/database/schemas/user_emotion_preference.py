from datetime import date
from pydantic import BaseModel
from typing import Optional


class UserEmotionPreference(BaseModel):
    id: Optional[str] = None
    userId: str

    preferredEmotions: list[str]
    avoidEmotions: list[str]
    allowHealingContent: bool
    allowMentalAlert: bool

    updatedAt: date