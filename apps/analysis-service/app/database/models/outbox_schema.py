from odmantic import Model
from datetime import datetime
from typing import List
from pydantic import HttpUrl


class Outbox(Model):
    topic: str
    event_type: str
    payload: dict
    processed: bool = False
    created_at: datetime = datetime.utcnow()
