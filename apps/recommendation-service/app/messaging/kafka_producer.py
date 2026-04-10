import json

from aiokafka import AIOKafkaProducer


class KafkaProducerService:
    def __init__(self, brokers: str):
        self.brokers = brokers
        self.producer: AIOKafkaProducer | None = None

    async def start(self):
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.brokers,
            acks="all",
            value_serializer=lambda value: json.dumps(value).encode("utf-8"),
        )
        await self.producer.start()

    async def stop(self):
        if self.producer:
            await self.producer.stop()

    async def send(self, topic: str, message: dict):
        if not self.producer:
            raise RuntimeError("Kafka producer has not been started")

        await self.producer.send_and_wait(topic, message)
