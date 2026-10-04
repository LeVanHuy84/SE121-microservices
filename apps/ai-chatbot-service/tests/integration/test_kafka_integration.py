import asyncio
import json
import logging
import os

import pytest
from testcontainers.kafka import KafkaContainer

from app.core.config import settings
from app.modules.analysis.messaging.kafka_consumer import KafkaConsumerService
from app.modules.analysis.messaging.kafka_producer import KafkaProducerService

logger = logging.getLogger(__name__)

@pytest.fixture(scope="module")
def kafka_container():
    """Spin up a real Kafka container for integration testing."""
    with KafkaContainer("confluentinc/cp-kafka:7.4.0") as container:
        yield container

@pytest.mark.asyncio
async def test_kafka_producer_consumer_integration(kafka_container: KafkaContainer):
    """
    Test real Kafka Producer and Consumer using TestContainers.
    Validates connection, serialization, publishing, and consuming.
    """
    brokers = kafka_container.get_bootstrap_server()
    topic = "test_crisis_alert"
    group_id = "test_chatbot_group"
    
    # Init Producer
    producer = KafkaProducerService(brokers)
    await producer.start()
    
    # Init Consumer
    received_messages = []

    async def mock_handler(messages):
        for msg in messages:
            received_messages.append(msg)
            
    consumer = KafkaConsumerService(
        brokers=brokers,
        topic=topic,
        group_id=group_id,
        batch_handler=mock_handler,
    )

    # Run consumer in background
    consumer_task = asyncio.create_task(consumer.start())

    # Wait a bit for the consumer group to stabilize
    await asyncio.sleep(2)

    # Send a test message
    test_message = {
        "userId": "user-123",
        "type": "crisis",
        "content": "Tôi muốn chết",
        "timestamp": "2026-10-04T12:00:00Z"
    }
    await producer.send(topic, test_message)

    # Wait for message to be processed
    for _ in range(30):
        if len(received_messages) > 0:
            break
        await asyncio.sleep(0.5)
        
    # Stop services
    await consumer.stop()
    await consumer_task
    await producer.stop()
    
    # Assertions
    assert len(received_messages) == 1, "Should have received exactly 1 message"
    received_data = received_messages[0]
    assert received_data["userId"] == "user-123"
    assert received_data["type"] == "crisis"
