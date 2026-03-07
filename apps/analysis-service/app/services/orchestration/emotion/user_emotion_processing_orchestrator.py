"""
Orchestration Service: User Emotion Processing Orchestrator

Coordinates emotion processing workflows across domain services and repositories.
This is the workflow/coordination layer - contains NO business logic computations.

Responsibilities:
- Handle emotion aggregate events
- Update user emotion profiles
- Recompute emotion snapshots
- Coordinate domain services and repositories

Architecture:
- Cron → Orchestrator → Domain services
- Orchestrator handles workflow, domain services handle computation
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta, timezone
from app.enums.emotion_enum import EmotionTimeWindowEnum

logger = logging.getLogger(__name__)


class UserEmotionProcessingOrchestrator:
    """
    Orchestration service for emotion processing workflows.
    
    Coordinates:
    - UserEmotionProfileService (domain)
    - UserEmotionSnapshotService (domain)
    - UserEmotionProfileRepository (infrastructure)
    - UserEmotionSnapshotRepository (infrastructure)
    - EmotionAggregateRepository (infrastructure)
    
    NO business logic - only workflow coordination.
    """

    def __init__(
        self,
        profile_service,
        snapshot_service,
        profile_repository,
        snapshot_repository,
        aggregate_repository
    ):
        """
        Initialize orchestrator with dependencies.
        
        Args:
            profile_service: UserEmotionProfileService
            snapshot_service: UserEmotionSnapshotService
            profile_repository: UserEmotionProfileRepository
            snapshot_repository: UserEmotionSnapshotRepository
            aggregate_repository: EmotionAggregateRepository
        """
        self.profile_service = profile_service
        self.snapshot_service = snapshot_service
        
        self.profile_repo = profile_repository
        self.snapshot_repo = snapshot_repository
        self.aggregate_repo = aggregate_repository

    # ========================================================================
    # WORKFLOW: Handle Emotion Aggregate Created Event
    # ========================================================================

    async def handle_emotion_aggregate_created(
        self,
        emotion_aggregate: dict,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Handle EmotionAggregateCreated event (IDEMPOTENT).
        
        Workflow:
        1. Validate aggregate data
        2. Load existing profile (if any)
        3. Update profile with idempotency check
        4. Handle concurrency conflicts via retry
        
        Args:
            emotion_aggregate: The newly created emotion aggregate
            max_retries: Max retry attempts for version conflicts (default: 3)
            
        Returns:
            Processing result dictionary
        """
        user_id = emotion_aggregate.get("userId")
        aggregate_id = emotion_aggregate.get("_id") or emotion_aggregate.get("id")
        final_scores = emotion_aggregate.get("finalScores", {})

        # Validation
        if not user_id or not final_scores:
            logger.warning("Invalid emotion aggregate: missing userId or finalScores")
            return {"success": False, "reason": "invalid_data"}

        if not aggregate_id:
            logger.warning("Invalid emotion aggregate: missing ID")
            return {"success": False, "reason": "missing_aggregate_id"}

        # Idempotent profile update with retry on version conflict
        result = await self._update_user_profile_idempotent(
            user_id=user_id,
            aggregate_id=aggregate_id,
            final_scores=final_scores,
            max_retries=max_retries
        )

        return result

    async def _update_user_profile_idempotent(
        self,
        user_id: str,
        aggregate_id: str,
        final_scores: Dict[str, float],
        max_retries: int
    ) -> Dict[str, Any]:
        """
        Update profile with idempotency and concurrency handling.
        
        Uses processedAggregateIds to prevent duplicate processing.
        Retries on version conflicts (optimistic locking).
        """
        retry_count = 0
        
        while retry_count <= max_retries:
            try:
                # Load current profile
                profile = await self.profile_repo.get_by_user_id(user_id)
                
                if profile:
                    # Check if already processed
                    processed_ids = profile.get("processedAggregateIds", [])
                    if aggregate_id in processed_ids:
                        logger.debug(
                            f"Aggregate {aggregate_id} already processed for user {user_id}"
                        )
                        return {
                            "success": True,
                            "userId": user_id,
                            "profileUpdated": False,
                            "alreadyProcessed": True
                        }
                    
                    # Update existing profile
                    updated_data = self.profile_service.update_profile_with_new_emotion(
                        current_profile=profile,
                        new_scores=final_scores
                    )
                    
                    # Add aggregate ID to processed list
                    updated_data["processedAggregateIds"] = processed_ids + [aggregate_id]
                    
                    # Save with version check
                    success = await self.profile_repo.update_with_version_check(
                        user_id=user_id,
                        current_version=profile.get("version", 0),
                        updated_data=updated_data
                    )
                    
                    if success:
                        logger.info(f"Updated emotion profile for user {user_id}")
                        return {
                            "success": True,
                            "userId": user_id,
                            "profileUpdated": True,
                            "versionConflicts": retry_count
                        }
                    else:
                        # Version conflict - retry
                        retry_count += 1
                        logger.warning(
                            f"Version conflict for user {user_id}, retry {retry_count}"
                        )
                        continue
                else:
                    # Create new profile
                    new_profile = self.profile_service.create_initial_profile(
                        user_id=user_id,
                        initial_scores=final_scores
                    )
                    new_profile["processedAggregateIds"] = [aggregate_id]
                    
                    await self.profile_repo.create(new_profile)
                    
                    logger.info(f"Created initial emotion profile for user {user_id}")
                    return {
                        "success": True,
                        "userId": user_id,
                        "profileUpdated": True,
                        "profileCreated": True
                    }
                    
            except Exception as e:
                logger.error(
                    f"Error updating profile for user {user_id}: {e}",
                    exc_info=True
                )
                
                if retry_count < max_retries:
                    retry_count += 1
                    continue
                else:
                    return {
                        "success": False,
                        "userId": user_id,
                        "error": str(e)
                    }
        
        # Max retries exceeded
        return {
            "success": False,
            "userId": user_id,
            "reason": "max_retries_exceeded"
        }

    # ========================================================================
    # WORKFLOW: Recompute User Snapshots
    # ========================================================================

    async def recompute_user_snapshots(self, user_id: str) -> Dict[str, Any]:
        """
        Recompute all snapshots for a specific user.
        
        Workflow:
        1. Load user profile (needed for risk calculation)
        2. For each time window (24h, 7d, 30d):
           a. Query aggregates
           b. Compute snapshot via domain service
           c. Upsert snapshot
        
        Args:
            user_id: User identifier
            
        Returns:
            Processing result dictionary
        """
        try:
            # Load user profile
            profile = await self.profile_repo.get_by_user_id(user_id)
            if not profile:
                logger.warning(f"No profile found for user {user_id}")
                return {
                    "success": False,
                    "userId": user_id,
                    "reason": "no_profile"
                }
            
            # Recompute all snapshots
            snapshots_updated = await self._recompute_all_snapshots(user_id, profile)
            
            return {
                "success": True,
                "userId": user_id,
                "snapshotsUpdated": snapshots_updated
            }
            
        except Exception as e:
            logger.error(f"Error recomputing for user {user_id}: {e}", exc_info=True)
            return {
                "success": False,
                "userId": user_id,
                "error": str(e)
            }

    async def _recompute_all_snapshots(
        self,
        user_id: str,
        profile: dict
    ) -> int:
        """
        Recompute all time window snapshots for a user.
        
        OPTIMIZED: Query MongoDB once for 30 days, then filter in-memory for shorter windows.
        This reduces DB queries from 3 per user to 1 per user.
        
        Performance:
        - Before: 3 queries/user → 1000 users = 3000 queries
        - After:  1 query/user  → 1000 users = 1000 queries
        
        Returns:
            Number of snapshots successfully updated
        """
        reference_time = datetime.now(timezone.utc)
        
        try:
            # OPTIMIZATION: Single MongoDB query for largest window (30 days)
            since_30d = reference_time - timedelta(days=30)
            all_aggregates = await self.aggregate_repo.get_by_user_since(
                user_id=user_id,
                since=since_30d,
                reference_time=reference_time
            )
            
            # Filter in-memory for shorter time windows
            since_7d = reference_time - timedelta(days=7)
            since_24h = reference_time - timedelta(hours=24)
            
            aggregates_30d = all_aggregates
            aggregates_7d = [
                agg for agg in all_aggregates
                if agg.get("createdAt") >= since_7d
            ]
            aggregates_24h = [
                agg for agg in all_aggregates
                if agg.get("createdAt") >= since_24h
            ]
            
            # Compute and upsert all 3 snapshots
            snapshot_configs = [
                (EmotionTimeWindowEnum.LAST_30_DAYS, aggregates_30d),
                (EmotionTimeWindowEnum.LAST_7_DAYS, aggregates_7d),
                (EmotionTimeWindowEnum.LAST_24_HOURS, aggregates_24h),
            ]
            
            updated_count = 0
            
            for window, aggregates in snapshot_configs:
                try:
                    # Compute snapshot (domain service)
                    snapshot_data = self.snapshot_service.compute_snapshot(
                        user_id=user_id,
                        window=window,
                        aggregates=aggregates,
                        user_profile=profile
                    )
                    
                    # Upsert snapshot (overwrites existing snapshot for this window)
                    await self.snapshot_repo.upsert(
                        user_id=user_id,
                        window=window,
                        data=snapshot_data
                    )
                    
                    updated_count += 1
                    
                except Exception as e:
                    logger.error(
                        f"Error computing {window.value} snapshot for user {user_id}: {e}"
                    )
            
            return updated_count
            
        except Exception as e:
            logger.error(
                f"Error recomputing snapshots for user {user_id}: {e}",
                exc_info=True
            )
            return 0

    # ========================================================================
    # WORKFLOW: Batch Recompute Snapshots for Recent Users
    # ========================================================================

    async def recompute_snapshots_for_recent_users(
        self,
        lookback_minutes: int = 10,
        max_users: int = 1000
    ) -> Dict[str, Any]:
        """
        Recompute snapshots for users updated in the last N minutes.
        
        Workflow:
        1. Find recently updated users (from profile repository)
        2. For each user:
           a. Recompute all snapshots
        3. Return summary stats
        
        Args:
            lookback_minutes: How far back to look (default: 10)
            max_users: Maximum users to process (default: 1000)
            
        Returns:
            Processing summary dictionary
        """
        start_time = datetime.now(timezone.utc)
        since = start_time - timedelta(minutes=lookback_minutes)
        
        logger.info(
            f"Starting batch snapshot update (lookback: {lookback_minutes}m, "
            f"max_users: {max_users})"
        )
        
        try:
            # Find recently updated users
            user_ids = await self.profile_repo.get_recently_updated_user_ids(
                since=since,
                limit=max_users
            )
            
            if not user_ids:
                logger.info("No users to process in this batch")
                return {
                    "success": True,
                    "usersProcessed": 0,
                    "snapshotsUpdated": 0,
                    "errors": 0,
                    "duration_seconds": 0
                }
            
            logger.info(f"Processing {len(user_ids)} users")
            
            # Process each user
            stats = {
                "usersProcessed": 0,
                "snapshotsUpdated": 0,
                "errors": 0
            }
            
            for user_id in user_ids:
                try:
                    result = await self.recompute_user_snapshots(user_id)
                    
                    stats["usersProcessed"] += 1
                    stats["snapshotsUpdated"] += result.get("snapshotsUpdated", 0)
                        
                except Exception as e:
                    logger.error(f"Error processing user {user_id}: {e}", exc_info=True)
                    stats["errors"] += 1
            
            duration = (datetime.now(timezone.utc) - start_time).total_seconds()
            
            logger.info(
                f"Batch update completed: {stats['usersProcessed']} users, "
                f"{stats['snapshotsUpdated']} snapshots, "
                f"{stats['errors']} errors in {duration:.2f}s"
            )
            
            return {
                "success": True,
                "duration_seconds": duration,
                **stats
            }
            
        except Exception as e:
            logger.error(f"Batch update failed: {e}", exc_info=True)
            return {
                "success": False,
                "error": str(e)
            }

    # ========================================================================
    # WORKFLOW: Full Recompute (Admin/Recovery)
    # ========================================================================

    async def recompute_all_active_users(
        self,
        hours_back: int = 24,
        batch_size: int = 100
    ) -> Dict[str, Any]:
        """
        Full recompute for all users active in the last N hours.
        
        Use case: Data migration or recovery after downtime
        
        Args:
            hours_back: How far back to look (default: 24 hours)
            batch_size: Users to process per batch (default: 100)
            
        Returns:
            Processing summary
        """
        since = datetime.now(timezone.utc) - timedelta(hours=hours_back)
        
        logger.info(
            f"Starting full recompute (hours_back: {hours_back}, "
            f"batch_size: {batch_size})"
        )
        
        total_stats = {
            "usersProcessed": 0,
            "snapshotsUpdated": 0,
            "errors": 0
        }
        
        offset = 0
        
        while True:
            # Get batch of users
            user_ids = await self.profile_repo.get_recently_updated_user_ids(
                since=since,
                limit=batch_size,
                offset=offset
            )
            
            if not user_ids:
                break
            
            logger.info(
                f"Processing batch {offset // batch_size + 1} "
                f"({len(user_ids)} users)"
            )
            
            # Process batch
            for user_id in user_ids:
                try:
                    result = await self.recompute_user_snapshots(user_id)
                    
                    total_stats["usersProcessed"] += 1
                    total_stats["snapshotsUpdated"] += result.get("snapshotsUpdated", 0)
                        
                except Exception as e:
                    logger.error(f"Error processing user {user_id}: {e}")
                    total_stats["errors"] += 1
            
            offset += batch_size
        
        logger.info(
            f"Full recompute completed: {total_stats['usersProcessed']} users, "
            f"{total_stats['snapshotsUpdated']} snapshots, "
            f"{total_stats['errors']} errors"
        )
        
        return {
            "success": True,
            **total_stats
        }
