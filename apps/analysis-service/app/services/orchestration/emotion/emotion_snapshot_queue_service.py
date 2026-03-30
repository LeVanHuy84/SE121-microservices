"""
Emotion Snapshot Queue Service

Manages the Redis SET of users whose emotion snapshots need recomputation.
Acts as a deduplication buffer between high-frequency emotion aggregate events
and the daily aggregation cron job.

Redis key: emotion:snapshot_dirty_users (SET)

Flow:
  EmotionAggregate created/updated
    → mark_user_dirty(user_id)       → SADD emotion:snapshot_dirty_users userId

    Daily cron job (00:05 UTC)
    → get_dirty_users()              → SMEMBERS emotion:snapshot_dirty_users
        → update profile + recompute snapshots per user
    → remove_user(user_id)           → SREM emotion:snapshot_dirty_users userId
"""

import logging
from app.redis.redis_client import redis_client

logger = logging.getLogger(__name__)

DIRTY_USERS_KEY = "emotion:snapshot_dirty_users"


class EmotionSnapshotQueueService:
    """
    Redis-backed queue for daily profile/snapshot recomputation.

    Uses a Redis SET to deduplicate users — adding the same userId multiple
    times has no effect; the cron job processes each user once per daily run.
    """

    async def mark_user_dirty(self, user_id: str) -> None:
        """
        Mark a user as needing snapshot recomputation.

        Uses SADD so repeated calls for the same user are idempotent.

        Args:
            user_id: The user whose snapshots are stale.
        """
        await redis_client.sadd(DIRTY_USERS_KEY, user_id)
        logger.debug(f"Marked user {user_id} as dirty for snapshot recomputation")

    async def get_dirty_users(self) -> set:
        """
        Retrieve all user IDs currently queued for recomputation.

        Returns:
            Set of user ID strings (may be empty).
        """
        return await redis_client.smembers(DIRTY_USERS_KEY)

    async def remove_user(self, user_id: str) -> None:
        """
        Remove a user from the dirty set after their snapshots have been recomputed.

        Uses SREM (not DEL) so other users added concurrently are not affected.

        Args:
            user_id: The user to remove from the queue.
        """
        await redis_client.srem(DIRTY_USERS_KEY, user_id)
        logger.debug(f"Removed user {user_id} from snapshot dirty queue")
