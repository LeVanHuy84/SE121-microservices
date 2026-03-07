"""
Cron Processor: User Emotion Snapshot Batch Update

Schedules periodic execution of user emotion snapshot batch updates.
Runs every 10 minutes with Redis lock to prevent duplicate processing across multiple instances.

ARCHITECTURE:
- Redis-based distributed lock (prevents duplicate runs)
- Automatic lock refresh during long-running batches
- Fault-tolerant: continues on individual user failures
- Graceful shutdown support

STRUCTURE:
Cron → Orchestrator → Domain services

This processor contains NO business logic - only scheduling and lock management.

USAGE:
    from app.processors.user_emotion_snapshot_cron import UserEmotionSnapshotCron
    
    # In main.py or startup script
    cron = UserEmotionSnapshotCron(orchestrator=orchestrator)
    
    # Start background task
    asyncio.create_task(cron.start())
    
    # Or run once manually
    await cron.run_once()
"""

import asyncio
import uuid
import logging
from datetime import datetime, timezone
from app.redis.redis_client import redis_client

logger = logging.getLogger(__name__)


class UserEmotionSnapshotCron:
    """
    Cron scheduler for emotion snapshot batch updates.
    
    CONFIGURATION:
    - INTERVAL: 10 minutes (600 seconds)
    - LOOKBACK: 10 minutes (processes users updated in last 10min)
    - LOCK_TTL: 5 minutes (300 seconds) - prevents stale locks
    - MAX_USERS: 1000 per batch
    
    DISTRIBUTED LOCK:
    - Uses Redis SETNX for coordination across multiple instances
    - Only one instance will run at a time
    - Lock auto-expires if instance crashes
    
    NO BUSINESS LOGIC:
    - Only scheduling and lock management
    - All workflow logic in orchestrator
    """
    
    LOCK_KEY = "user_emotion_snapshot_cron_lock"
    LOCK_TTL = 300  # 5 minutes (should be < INTERVAL_SECONDS)
    INTERVAL_SECONDS = 600  # 10 minutes
    LOOKBACK_MINUTES = 10
    MAX_USERS_PER_BATCH = 1000
    
    def __init__(self, orchestrator):
        """
        Initialize cron processor.
        
        Args:
            orchestrator: UserEmotionProcessingOrchestrator instance
        """
        self.orchestrator = orchestrator
        self.instance_id = str(uuid.uuid4())  # Unique ID for this instance
        self._running = False
        
        logger.info(
            f"UserEmotionSnapshotCron initialized (instance: {self.instance_id})"
        )
    
    # --------------------------------------------------
    # Lock Management
    # --------------------------------------------------
    
    async def acquire_lock(self) -> bool:
        """
        Attempt to acquire distributed lock via Redis SETNX.
        
        Returns:
            True if lock acquired successfully, False if another instance holds the lock
        """
        try:
            acquired = await redis_client.set(
                self.LOCK_KEY,
                self.instance_id,
                ex=self.LOCK_TTL,
                nx=True  # Set only if not exists
            )
            
            if acquired:
                logger.debug(f"Lock acquired by instance {self.instance_id}")
            else:
                logger.debug("Lock already held by another instance")
            
            return acquired
        except Exception as e:
            logger.error(f"Error acquiring lock: {e}")
            return False
    
    async def refresh_lock(self) -> bool:
        """
        Refresh lock TTL (only if this instance owns the lock).
        
        Call this periodically during long-running batch processing
        to prevent lock expiration.
        
        Returns:
            True if lock refreshed successfully, False otherwise
        """
        try:
            owner = await redis_client.get(self.LOCK_KEY)
            
            if owner != self.instance_id:
                logger.warning(
                    f"Cannot refresh lock: owned by {owner}, not {self.instance_id}"
                )
                return False
            
            await redis_client.expire(self.LOCK_KEY, self.LOCK_TTL)
            logger.debug(f"Lock refreshed by instance {self.instance_id}")
            return True
        except Exception as e:
            logger.error(f"Error refreshing lock: {e}")
            return False
    
    async def release_lock(self):
        """
        Release lock (only if this instance owns it).
        """
        try:
            owner = await redis_client.get(self.LOCK_KEY)
            
            if owner == self.instance_id:
                await redis_client.delete(self.LOCK_KEY)
                logger.debug(f"Lock released by instance {self.instance_id}")
        except Exception as e:
            logger.error(f"Error releasing lock: {e}")
    
    # --------------------------------------------------
    # Cron Execution
    # --------------------------------------------------
    
    async def start(self):
        """
        Start continuous cron loop.
        
        Runs every INTERVAL_SECONDS (10 minutes).
        Only executes if lock is acquired.
        
        USAGE:
            asyncio.create_task(cron.start())
        """
        self._running = True
        
        logger.info(
            f"UserEmotionSnapshotCron started "
            f"(interval: {self.INTERVAL_SECONDS}s, instance: {self.instance_id})"
        )
        
        while self._running:
            try:
                # Try to acquire lock
                has_lock = await self.acquire_lock()
                
                if not has_lock:
                    # Another instance is running - skip this cycle
                    logger.debug(
                        f"Skipping cron cycle (lock held by another instance) - "
                        f"next attempt in {self.INTERVAL_SECONDS}s"
                    )
                    await asyncio.sleep(self.INTERVAL_SECONDS)
                    continue
                
                # Lock acquired - run batch update
                logger.info("=== Starting scheduled batch update ===")
                
                try:
                    result = await self.run_batch_with_lock_refresh()
                    
                    if result.get("success"):
                        logger.info(
                            f"Batch update completed: "
                            f"{result.get('usersProcessed', 0)} users, "
                            f"{result.get('snapshotsUpdated', 0)} snapshots, "
                            f"{result.get('errors', 0)} errors in "
                            f"{result.get('duration_seconds', 0):.2f}s"
                        )
                    else:
                        logger.error(f"Batch update failed: {result.get('error')}")
                finally:
                    # Always release lock when done
                    await self.release_lock()
                
            except Exception as e:
                logger.error(f"Cron execution error: {e}", exc_info=True)
                # Release lock on error
                await self.release_lock()
            
            # Wait for next cycle
            await asyncio.sleep(self.INTERVAL_SECONDS)
    
    async def run_batch_with_lock_refresh(self):
        """
        Run batch update with periodic lock refresh.
        
        Refreshes lock every 2 minutes during processing to prevent expiration.
        """
        # Create lock refresh task
        refresh_task = asyncio.create_task(self._periodic_lock_refresh())
        
        try:
            # Call orchestrator to run batch update
            result = await self.orchestrator.recompute_snapshots_for_recent_users(
                lookback_minutes=self.LOOKBACK_MINUTES,
                max_users=self.MAX_USERS_PER_BATCH
            )
            return result
        finally:
            # Stop lock refresh task
            refresh_task.cancel()
            try:
                await refresh_task
            except asyncio.CancelledError:
                pass
    
    async def _periodic_lock_refresh(self):
        """
        Background task to refresh lock every 2 minutes.
        """
        try:
            while True:
                await asyncio.sleep(120)  # Refresh every 2 minutes
                await self.refresh_lock()
        except asyncio.CancelledError:
            pass
    
    async def run_once(self):
        """
        Run batch update once (manual trigger).
        
        Does NOT require lock - useful for manual/admin triggers.
        
        Returns:
            Processing result dictionary
        """
        logger.info("Manual batch update triggered")
        
        result = await self.orchestrator.recompute_snapshots_for_recent_users(
            lookback_minutes=self.LOOKBACK_MINUTES,
            max_users=self.MAX_USERS_PER_BATCH
        )
        
        logger.info(f"Manual batch update completed: {result}")
        return result
    
    def stop(self):
        """
        Stop cron loop gracefully.
        """
        logger.info("Stopping UserEmotionSnapshotCron...")
        self._running = False
    
    async def shutdown(self):
        """
        Graceful shutdown: stop loop and release lock.
        """
        self.stop()
        await self.release_lock()
        logger.info("UserEmotionSnapshotCron shutdown complete")


# --------------------------------------------------
# Standalone Execution (for testing)
# --------------------------------------------------

async def main():
    """
    Standalone execution for testing.
    
    USAGE:
        python -m app.processors.user_emotion_snapshot_cron
    
    ARCHITECTURE:
    - Uses Motor async driver with global collection registry
    - Follows layered pattern: Collections → Repositories → Services → Orchestrator → Cron
    """
    from app.database.mongo import collections
    from app.database.user_emotion_profile_repository import (
        UserEmotionProfileRepository
    )
    from app.database.user_emotion_snapshot_repository import (
        UserEmotionSnapshotRepository
    )
    from app.database.emotion_aggregate_repository import (
        EmotionAggregateRepository
    )
    from app.services.domain.emotion.user_emotion_profile_service import (
        UserEmotionProfileService
    )
    from app.services.domain.emotion.user_emotion_snapshot_service import (
        UserEmotionSnapshotService
    )
    from app.services.orchestration.emotion.user_emotion_processing_orchestrator import (
        UserEmotionProcessingOrchestrator
    )
    
    # Setup logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Initialize repositories using Motor collections (not database object)
    profile_repo = UserEmotionProfileRepository(collections['user_emotion_profiles'])
    snapshot_repo = UserEmotionSnapshotRepository(collections['user_emotion_snapshots'])
    aggregate_repo = EmotionAggregateRepository(collections['emotion_aggregates'])
    
    # Initialize domain services
    profile_service = UserEmotionProfileService()
    snapshot_service = UserEmotionSnapshotService()
    
    # Initialize orchestrator
    orchestrator = UserEmotionProcessingOrchestrator(
        profile_service=profile_service,
        snapshot_service=snapshot_service,
        profile_repository=profile_repo,
        snapshot_repository=snapshot_repo,
        aggregate_repository=aggregate_repo
    )
    
    # Create cron instance
    cron = UserEmotionSnapshotCron(orchestrator=orchestrator)
    
    try:
        # Start cron (runs indefinitely)
        await cron.start()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
        await cron.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
