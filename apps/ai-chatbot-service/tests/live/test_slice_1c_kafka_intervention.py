from __future__ import annotations

import asyncio
import json
import os
import unittest
from uuid import uuid4

from aiokafka import AIOKafkaProducer

from tests.live.harness import (
    DEFAULT_KAFKA_BROKERS,
    cleanup_run_namespace,
    ensure_slice_ready,
    generate_run_id,
    get_mongo_client,
    get_redis_client,
    make_test_user_id,
    poll_until,
    run_prefix,
)


async def _publish_analysis_event(payload: dict) -> None:
    producer = AIOKafkaProducer(
        bootstrap_servers=DEFAULT_KAFKA_BROKERS.split(","),
        value_serializer=lambda v: json.dumps(v).encode("utf-8"),
    )
    await producer.start()
    try:
        await producer.send_and_wait("analysis-events", payload)
    finally:
        await producer.stop()


class Slice1CKafkaInterventionTests(unittest.TestCase):
    run_id: str
    prefix: str

    @classmethod
    def setUpClass(cls) -> None:
        ensure_slice_ready("1C")
        cls.run_id = generate_run_id()
        cls.prefix = run_prefix(cls.run_id)

    @classmethod
    def tearDownClass(cls) -> None:
        cleanup_run_namespace(cls.prefix)

    def test_kafka_analysis_event_pipeline(self) -> None:
        uid = make_test_user_id(self.run_id, "kafka")
        target_id = f"{self.prefix}post_{uuid4().hex[:6]}"
        event_id = f"{self.prefix}evt_{uuid4().hex[:6]}"
        event_payload = {
            "type": "analysis_created",
            "payload": {
                "eventId": event_id,
                "userId": uid,
                "targetId": target_id,
                "targetType": "POST",
                "content": "Hôm nay mình cảm thấy rất buồn và mệt mỏi.",
                "imageUrls": [],
            },
        }
        asyncio.run(_publish_analysis_event(event_payload))

        mongo_db_name = os.getenv("MONGO_DB", "ai_chatbot_service")
        mongo_client = get_mongo_client()
        redis_client = get_redis_client()
        try:

            def _check_processed_or_acute():
                processed = mongo_client[mongo_db_name]["processed_events"].find_one(
                    {
                        "$or": [
                            {"targetId": target_id},
                            {"eventId": event_id},
                        ]
                    }
                )
                aggregate = mongo_client[mongo_db_name]["emotion_aggregates"].find_one(
                    {"targetId": target_id}
                )
                acute = redis_client.hgetall(f"chatbot:emotion:acute:{uid}")
                if processed or aggregate or acute:
                    return {
                        "processed": processed,
                        "aggregate": aggregate,
                        "acute": acute,
                    }
                return None

            result = poll_until(
                _check_processed_or_acute,
                timeout_seconds=10.0,
                description=f"Kafka analysis-events processing for {uid}",
            )
            self.assertTrue(
                result["processed"] or result["aggregate"] or result["acute"]
            )
        finally:
            mongo_client.close()
            redis_client.close()


if __name__ == "__main__":
    unittest.main()
