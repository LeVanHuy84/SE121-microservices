import json

from aiokafka import AIOKafkaConsumer


class KafkaConsumerService:
    def __init__(self, brokers: str, topic: str, group_id: str, handler):
        self.brokers = brokers
        self.topic = topic
        self.group_id = group_id
        self.handler = handler
        self.consumer: AIOKafkaConsumer | None = None

    async def start(self):
        self.consumer = AIOKafkaConsumer(
            self.topic,
            bootstrap_servers=self.brokers,
            group_id=self.group_id,
            enable_auto_commit=True,
            value_deserializer=lambda value: json.loads(value.decode("utf-8")),
        )
        await self.consumer.start()

        async for message in self.consumer:
            await self.handler(message.value)

    async def stop(self):
        if self.consumer:
            await self.consumer.stop()
