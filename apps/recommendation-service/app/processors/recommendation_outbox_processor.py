import asyncio
import logging

from app.database.recommendation_state_repository import RecommendationStateRepository
from app.messaging.kafka_producer import KafkaProducerService

logger = logging.getLogger(__name__)


class RecommendationOutboxProcessor:
    def __init__(
        self,
        repository: RecommendationStateRepository,
        producer: KafkaProducerService,
    ):
        self.repository = repository
        self.producer = producer
        self._running = False

    async def start(self, interval_seconds: int = 5):
        self._running = True

        while self._running:
            try:
                await self.run_once()
            except Exception:
                logger.exception("Recommendation outbox processor iteration failed")

            await asyncio.sleep(max(1, interval_seconds))

    async def run_once(self):
        events = self.repository.list_pending_outbox_events(limit=100)
        if not events:
            return

        for event in events:
            locked = self.repository.lock_outbox_event(event["id"])
            if not locked:
                continue

            try:
                await self.producer.send(
                    event["topic"],
                    {
                        "type": event["eventType"],
                        "payload": event["payload"],
                    },
                )
                logger.info(
                    "Recommendation outbox event published: id=%s topic=%s type=%s",
                    event["id"],
                    event["topic"],
                    event["eventType"],
                )
            except Exception:
                self.repository.reset_outbox_event(event["id"])
                logger.exception(
                    "Recommendation outbox event publish failed: id=%s topic=%s type=%s",
                    event["id"],
                    event["topic"],
                    event["eventType"],
                )

    def stop(self):
        self._running = False
