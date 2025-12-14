from odmantic import Model
from datetime import datetime, timezone

class Outbox(Model):
    topic: str
    eventType: str
    payload: dict
    processed: bool = False
    createdAt: datetime = datetime.now(timezone.utc)