"""
Motor AsyncIO MongoDB Client
Pure async driver without ORM/ODM layer
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection
from app.core.config import settings

# ============================================
# MongoDB Client Setup
# ============================================
client: AsyncIOMotorClient = AsyncIOMotorClient(settings.MONGO_URL)
db: AsyncIOMotorDatabase = client[settings.MONGO_DB]

# ============================================
# Collection References
# ============================================
collections = {
    'analysis_tasks': db['analysis_tasks'],
    'moderation_results': db['moderation_results'],
    'emotion_aggregates': db['emotion_aggregates'],
    'user_emotion_profiles': db['user_emotion_profiles'],
    'user_emotion_snapshots': db['user_emotion_snapshots'],
    'outbox_events': db['outbox_events'],
}


def get_collection(name: str) -> AsyncIOMotorCollection:
    """Get a collection by name"""
    if name not in collections:
        raise ValueError(f"Collection '{name}' not found in collections dict")
    return collections[name]
