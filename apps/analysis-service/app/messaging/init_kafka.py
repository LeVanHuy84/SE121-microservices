import asyncio
from app.messaging.kafka_producer import KafkaProducerService
from app.messaging.kafka_consumer import KafkaConsumerService

# Global references
kafka_producer: KafkaProducerService | None = None
consumers: list[KafkaConsumerService] = []

def register_consumer(consumer: KafkaConsumerService):
    consumers.append(consumer)

async def start_kafka(settings):
    global kafka_producer

    # Init producer với settings
    kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)

    # Start producer
    asyncio.create_task(kafka_producer.start())

    # Start all consumers
    for c in consumers:
        asyncio.create_task(c.start())
