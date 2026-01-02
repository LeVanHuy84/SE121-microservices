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
            value_deserializer=lambda v: json.loads(v.decode("utf-8")),
        )
        await self.consumer.start()

        while True:
            async for msg in self.consumer:
                try:
                    await self.handler(msg.value)
                except Exception as e:
                    print("Consumer handler error:", e)


    async def stop(self):
        if self.consumer:
            await self.consumer.stop()
