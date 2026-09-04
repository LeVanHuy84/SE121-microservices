import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class KafkaDLQService:
    """
    DLQ Service for Python Kafka Consumers.
    Sends unrecoverable/failed messages to ${topic}.DLQ.
    Compatible with NestJS KafkaDLQService in @repo/common.
    """

    def __init__(self, kafka_producer=None):
        self.kafka_producer = kafka_producer

    def set_producer(self, kafka_producer):
        self.kafka_producer = kafka_producer

    async def send_to_dlq(
        self,
        topic: str,
        message: Dict[str, Any],
        error: Exception,
        metadata: Optional[Dict[str, Any]] = None
    ):
        if not self.kafka_producer:
            logger.warning("[KafkaDLQ] Kafka producer not initialized. Cannot send to DLQ.")
            return

        dlq_topic = f"{topic}.DLQ"
        payload = {
            "originalTopic": topic,
            "message": message,
            "error": {
                "message": str(error),
                "type": type(error).__name__,
            },
            "metadata": metadata or {},
            "failedAt": datetime.now(timezone.utc).isoformat(),
        }

        try:
            await self.kafka_producer.send(dlq_topic, payload)
            logger.warn(f"☠️ [KafkaDLQ] Sent failed event to DLQ [{dlq_topic}] - Reason: {str(error)}")
        except Exception as e:
            logger.error(f"[KafkaDLQ] Error sending message to DLQ topic [{dlq_topic}]: {e}")
