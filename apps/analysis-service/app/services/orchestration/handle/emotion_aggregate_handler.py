"""
Orchestration Handler: Emotion Aggregate Event Handler (PRODUCTION VERSION)

Coordinates user emotion model updates when EmotionAggregateCreated events occur.
Follows Clean Architecture - orchestrates domain services and repositories.

PRODUCTION CHANGES:
- Idempotent profile updates (prevents duplicate processing)
- Concurrency-safe with optimistic locking
- Removed real-time snapshot computation (moved to batch processor)
- Removed preference updates (moved to batch processor)

This handler NOW ONLY:
1. Updates UserEmotionProfile (EMA baseline) - IDEMPOTENT
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class EmotionAggregateHandler:
    """
    Orchestration handler for EmotionAggregate events.
    
    PRODUCTION VERSION:
    - Only updates user emotion profile
    - Idempotent (safe to process same aggregate multiple times)
    - Concurrency-safe via optimistic locking
    
    Snapshots and preferences are now handled by:
    - UserEmotionSnapshotBatchProcessor (runs every 5 minutes)
    
    Coordinates:
    - Domain service: UserEmotionProfileService
    - Repository: UserEmotionProfileRepository
    """

    def __init__(
        self,
        profile_service,
        profile_repository
    ):
        self.profile_service = profile_service
        self.profile_repo = profile_repository

    async def handle_emotion_aggregate_created(
        self,
        emotion_aggregate: dict,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """
        Handle EmotionAggregateCreated event (IDEMPOTENT).
        
        Production-safe workflow:
        1. Validate aggregate data
        2. Load existing profile (if any)
        3. Update profile with idempotency check
        4. Handle concurrency conflicts via retry
        
        Args:
            emotion_aggregate: The newly created emotion aggregate
            max_retries: Max retry attempts for version conflicts (default: 3)
            
        Returns:
            Dictionary with processing results:
            {
                "success": bool,
                "userId": str,
                "profileUpdated": bool,
                "alreadyProcessed": bool,  # True if duplicate
                "versionConflicts": int    # Number of retries needed
            }
        """
        user_id = emotion_aggregate.get("userId")
        aggregate_id = emotion_aggregate.get("_id") or emotion_aggregate.get("id")
        final_scores = emotion_aggregate.get("finalScores", {})

        # Validation
        if not user_id or not final_scores:
            logger.warning(f"Invalid emotion aggregate: missing userId or finalScores")
            return {"success": False, "reason": "invalid_data"}

        if not aggregate_id:
            logger.warning(f"Invalid emotion aggregate: missing ID")
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
        final_scores: dict,
        max_retries: int
    ) -> Dict[str, Any]:
        """
        Update user profile with idempotency and concurrency handling.
        
        Handles:
        - Duplicate aggregate processing (idempotent skip)
        - Concurrent updates (retry with exponential backoff)
        - First-time profile creation
        
        Returns:
            Processing result dictionary
        """
        version_conflicts = 0
        
        for attempt in range(max_retries):
            try:
                existing_profile = await self.profile_repo.get_by_user_id(user_id)

                if existing_profile:
                    # Update existing profile with idempotency check
                    success, updated = await self._try_update_existing_profile(
                        existing_profile=existing_profile,
                        aggregate_id=aggregate_id,
                        final_scores=final_scores
                    )
                    
                    if not success:
                        # Already processed this aggregate
                        logger.info(
                            f"Aggregate {aggregate_id} already processed for user {user_id}"
                        )
                        return {
                            "success": True,
                            "userId": user_id,
                            "profileUpdated": False,
                            "alreadyProcessed": True,
                            "versionConflicts": version_conflicts
                        }
                    
                    if updated:
                        # Successfully updated
                        logger.info(
                            f"Profile updated for user {user_id} "
                            f"(aggregate: {aggregate_id}, conflicts: {version_conflicts})"
                        )
                        return {
                            "success": True,
                            "userId": user_id,
                            "profileUpdated": True,
                            "alreadyProcessed": False,
                            "versionConflicts": version_conflicts
                        }
                    else:
                        # Version conflict - retry
                        version_conflicts += 1
                        logger.warning(
                            f"Version conflict for user {user_id}, "
                            f"attempt {attempt + 1}/{max_retries}"
                        )
                        continue
                else:
                    # Create initial profile
                    await self._create_initial_profile(
                        user_id=user_id,
                        aggregate_id=aggregate_id,
                        final_scores=final_scores
                    )
                    
                    logger.info(
                        f"Initial profile created for user {user_id} "
                        f"(aggregate: {aggregate_id})"
                    )
                    return {
                        "success": True,
                        "userId": user_id,
                        "profileUpdated": True,
                        "alreadyProcessed": False,
                        "versionConflicts": 0
                    }

            except Exception as e:
                logger.error(
                    f"Error updating profile for user {user_id}: {e}",
                    exc_info=True
                )
                if attempt == max_retries - 1:
                    return {
                        "success": False,
                        "userId": user_id,
                        "error": str(e),
                        "versionConflicts": version_conflicts
                    }
        
        # Max retries exceeded
        logger.error(
            f"Max retries ({max_retries}) exceeded for user {user_id} "
            f"due to version conflicts"
        )
        return {
            "success": False,
            "userId": user_id,
            "reason": "max_retries_exceeded",
            "versionConflicts": version_conflicts
        }

    async def _try_update_existing_profile(
        self,
        existing_profile: dict,
        aggregate_id: str,
        final_scores: dict
    ) -> tuple[bool, bool]:
        """
        Try to update existing profile.
        
        Returns:
            Tuple of (can_proceed, update_success)
            - (False, False): Already processed, skip
            - (True, True): Successfully updated
            - (True, False): Version conflict, retry needed
        """
        user_id = existing_profile["userId"]
        current_version = existing_profile.get("version", 1)
        
        # Calculate updated profile data
        updated_data = self.profile_service.update_profile_with_new_emotion(
            current_profile=existing_profile,
            new_scores=final_scores
        )
        
        # Atomic idempotent update with version check
        success, result = await self.profile_repo.update_with_idempotency(
            user_id=user_id,
            aggregate_id=aggregate_id,
            update_data=updated_data,
            current_version=current_version
        )
        
        if not success and result:
            # Check if already processed
            if result.get("lastProcessedAggregateId") == aggregate_id:
                return (False, False)  # Already processed
            else:
                return (True, False)  # Version conflict
        
        return (True, success)

    async def _create_initial_profile(
        self,
        user_id: str,
        aggregate_id: str,
        final_scores: dict
    ) -> dict:
        """
        Create initial profile for new user.
        
        Sets lastProcessedAggregateId to prevent reprocessing.
        """
        initial_profile = self.profile_service.create_initial_profile(
            user_id=user_id,
            initial_scores=final_scores
        )
        
        return await self.profile_repo.create_with_aggregate_id(
            data=initial_profile,
            aggregate_id=aggregate_id
        )
