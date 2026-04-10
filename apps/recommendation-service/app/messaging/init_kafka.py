import asyncio

from app.messaging.kafka_consumer import KafkaConsumerService

consumers: list[KafkaConsumerService] = []


def register_consumer(consumer: KafkaConsumerService):
    if consumer not in consumers:
        consumers.append(consumer)


async def start_kafka() -> list[asyncio.Task]:
    tasks: list[asyncio.Task] = []

    for consumer in consumers:
        tasks.append(asyncio.create_task(consumer.start()))

    return tasks
