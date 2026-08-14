from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from app.core.settings import settings

client: AsyncIOMotorClient | None = None
db: AsyncIOMotorDatabase | None = None

def init_database() -> AsyncIOMotorDatabase:
    global client, db
    if client is None:
        client = AsyncIOMotorClient(settings.MONGO_URL)
        db = client[settings.MONGO_DB]
    return db

def get_database() -> AsyncIOMotorDatabase:
    global db
    if db is None:
        return init_database()
    return db

async def close_database():
    global client, db
    if client is not None:
        client.close()
        client = None
        db = None
