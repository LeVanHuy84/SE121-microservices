import asyncio
import logging
from typing import List, Dict, Any, Callable
from app.modules.analysis.repositories.idempotency import IdempotencyRepository
from app.modules.analysis.messaging.dlq_service import KafkaDLQService

logger = logging.getLogger(__name__)


class KafkaConsumerHelper:
    """
    Kafka Consumer Helper providing Enterprise Event Integrity:
    - Pre-filter Idempotency (Item-level deduplication via MongoDB processed_events)
    - Retry Async with Exponential Backoff (1s -> 2s -> 4s)
    - Dead Letter Queue (DLQ) Fallback for unrecoverable errors
    """

    def __init__(
        self,
        idempotency_repo: IdempotencyRepository,
        dlq_service: KafkaDLQService,
        max_retries: int = 3,
        initial_backoff_sec: float = 1.0,
    ):
        self.idempotency_repo = idempotency_repo
        self.dlq_service = dlq_service
        self.max_retries = max_retries
        self.initial_backoff_sec = initial_backoff_sec

    async def handle_single(self, message: Dict[str, Any], handler: Callable, topic: str = "analysis-events"):
        """Handle single event with Idempotency, Retry, and DLQ."""
        payload = message.get("payload") if isinstance(message, dict) and isinstance(message.get("payload"), dict) else {}
        event_id = message.get("eventId") or message.get("id") or payload.get("eventId") or payload.get("targetId")
        
        if event_id:
            acquired = await self.idempotency_repo.try_acquire(event_id)
            if not acquired:
                logger.info(f"[ConsumerHelper] Skip duplicate eventId: {event_id}")
                return

        success = False
        last_exception = None

        for attempt in range(1, self.max_retries + 1):
            try:
                await handler(message)
                success = True
                break
            except Exception as e:
                last_exception = e
                logger.warning(f"[ConsumerHelper] Retry attempt {attempt}/{self.max_retries} for event {event_id}: {e}")
                if attempt < self.max_retries:
                    await asyncio.sleep(self.initial_backoff_sec * (2 ** (attempt - 1)))

        if success:
            if event_id:
                await self.idempotency_repo.mark_done(event_id)
        else:
            logger.error(f"[ConsumerHelper] Event {event_id} failed after {self.max_retries} retries -> Sending to DLQ")
            if event_id:
                await self.idempotency_repo.mark_failed(event_id, reason=str(last_exception))
            await self.dlq_service.send_to_dlq(topic=topic, message=message, error=last_exception)

    async def handle_batch(self, messages: List[Dict[str, Any]], handler: Callable, topic: str = "analysis-events"):
        """
        Handle Batch of events with Item-level Idempotency filtering:
        1. Extract all eventIds and pre-filter unprocessed ones from Mongo.
        2. Acquire lock for valid items.
        3. Dispatch each item with Retry and DLQ protection.
        """
        if not messages:
            return

        # 1. Map event_ids
        msg_map = {}
        valid_messages = []
        
        for msg in messages:
            payload = msg.get("payload") if isinstance(msg, dict) and isinstance(msg.get("payload"), dict) else {}
            eid = msg.get("eventId") or msg.get("id") or payload.get("eventId") or payload.get("targetId")
            if eid:
                msg_map[eid] = msg
            valid_messages.append((eid, msg))

        # 2. Bulk check idempotency
        all_eids = [eid for eid in msg_map.keys() if eid]
        unprocessed_eids = await self.idempotency_repo.filter_unprocessed_event_ids(all_eids)

        # 3. Process each valid item individually
        for eid, msg in valid_messages:
            if eid and eid not in unprocessed_eids:
                logger.info(f"[ConsumerHelper Batch] Skipping duplicate/already processed event: {eid}")
                continue

            await self.handle_single(message=msg, handler=handler, topic=topic)
