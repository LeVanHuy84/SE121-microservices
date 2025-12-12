import json
from aiokafka import AIOKafkaProducer

class KafkaProducerService:
    def __init__(self, brokers: str):
        self.brokers = brokers
        self.producer = None

    async def start(self):
        self.producer = AIOKafkaProducer(
            bootstrap_servers=self.brokers,
            acks="all",
            linger_ms=5,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
        )
        await self.producer.start()

    async def stop(self):
        if self.producer:
            await self.producer.stop()

    async def send(self, topic: str, message: dict):
        await self.producer.send_and_wait(topic, message)
