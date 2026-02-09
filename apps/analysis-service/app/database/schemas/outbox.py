from pydantic import BaseModel, Field
from datetime import datetime, timezone
from typing import Optional

class Outbox(BaseModel):
    id: Optional[str] = None
    topic: str
    eventType: str
    payload: dict
    processed: bool = False
    createdAt: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))