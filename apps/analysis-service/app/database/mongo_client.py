from odmantic import AIOEngine
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings

client = AsyncIOMotorClient(settings.MONGO_URL)
engine = AIOEngine(client=client, database=settings.MONGO_DB)
