"""
Motor AsyncIO MongoDB Client
Pure async driver without ORM/ODM layer
"""
from motor.motor_asyncio import AsyncIOMotorDatabase, AsyncIOMotorCollection
from app.core.database import get_database

# ============================================
# MongoDB Client Setup
# ============================================
db: AsyncIOMotorDatabase = get_database()

# ============================================
# Collection References
# ============================================
collections = {
    'analysis_tasks': db['analysis_tasks'],
    'moderation_results': db['moderation_results'],
    'emotion_aggregates': db['emotion_aggregates'],
    'outbox_events': db['outbox_events'],
    'processed_events': db['processed_events'],
}


def get_collection(name: str) -> AsyncIOMotorCollection:
    """Get a collection by name"""
    if name not in collections:
        raise ValueError(f"Collection '{name}' not found in collections dict")
    return collections[name]
