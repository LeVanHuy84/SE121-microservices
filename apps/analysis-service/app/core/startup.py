# app/core/startup.py
import asyncio
from fastapi import FastAPI

from app.core.config import settings
from app.messaging.init_kafka import start_kafka, register_consumer
from app.messaging.kafka_consumer import KafkaConsumerService
from app.messaging.kafka_producer import KafkaProducerService
from app.processors.batch_processor import OutboxBatchProcessor
from app.database.outbox_repository import OutboxRepository
from app.database.mongo_client import engine
from app.messaging.event_dispatcher import EventDispatcher
from app.services.handle_event_service import HandleEventService
from app.database.analysis_repository import AnalysisRepository

app = FastAPI()

# -------------------------------------------------------
# INIT singletons
# -------------------------------------------------------
outbox_repo = OutboxRepository(engine)
kafka_producer = KafkaProducerService(settings.KAFKA_BROKERS)
processor = OutboxBatchProcessor(outbox_repo, kafka_producer)

analysis_repo = AnalysisRepository(engine)
event_service = HandleEventService(analysis_repo)

dispatcher = EventDispatcher(event_service, outbox_repo)

# -------------------------------------------------------
# Kafka Consumer Handler
# -------------------------------------------------------
async def handle_analysis_event(msg):
    print("Received message:", msg)
    await dispatcher.dispatch(msg)


register_consumer(
    KafkaConsumerService(
        brokers=settings.KAFKA_BROKERS,
        topic="analysis-events",
        group_id=settings.KAFKA_CLIENT_ID,
        handler=handle_analysis_event,
    )
)

# -------------------------------------------------------
# Background tasks registry
# -------------------------------------------------------
background_tasks = []


# -------------------------------------------------------
# STARTUP
# -------------------------------------------------------
@app.on_event("startup")
async def startup_tasks():
    # Kafka Producer
    await kafka_producer.start()
    print("[KafkaProducer] Started")

    # Kafka Consumer Loop
    t1 = asyncio.create_task(start_kafka(settings))
    background_tasks.append(t1)
    print("[KafkaConsumer] Started")

    # Outbox Processor
    t2 = asyncio.create_task(processor.start(interval_seconds=5))
    background_tasks.append(t2)
    print("[OutboxBatchProcessor] Started")


# -------------------------------------------------------
# SHUTDOWN
# -------------------------------------------------------
@app.on_event("shutdown")
async def shutdown_tasks():
    print("Shutting down cleanly...")

    # Stop Kafka producer
    await kafka_producer.stop()

    # Cancel all background tasks
    for task in background_tasks:
        task.cancel()

    await asyncio.gather(*background_tasks, return_exceptions=True)

    print("All background tasks stopped.")
