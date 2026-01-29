# app/services/orchestration/handle_event_service.py

"""
Application Service: Event Handler Orchestration
- Xử lý Kafka events (created, updated)
- Tích hợp với AnalysisFlowService
- Quản lý DB persistence
"""

import logging
from datetime import datetime, timezone
from typing import List, Dict

from app.services.orchestration.analysis_flow_service import analysis_flow_service
from app.database.analysis_repository import AnalysisRepository
from app.database.schemas.emotion_aggregate import EmotionAggregate
from app.enums.analysis_status_enum import AnalysisStatusEnum, RetryScopeEnum
from app.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)


class HandleEventService:
    """
    Application service for handling Kafka events.
    Orchestrates analysis flow and database persistence.
    """
    
    def __init__(self, repo: AnalysisRepository):
        """
        Initialize event handler.
        
        Args:
            repo: Analysis repository for DB operations
        """
        self.repo = repo

    async def handle_created(self, event: dict) -> EmotionAggregate:
        """
        Handle content created event.
        
        Args:
            event: Kafka event payload
            
        Returns:
            Saved EmotionAggregate document
        """
        text = event["content"]
        image_urls = event.get("imageUrls", [])
        user_id = event["userId"]
        target_id = event["targetId"]
        target_type = event["targetType"]
        
        # Fetch user history for risk scoring
        user_history = await self._fetch_user_history(user_id)
        
        # Get post time
        post_time = event.get("createdAt")
        if isinstance(post_time, str):
            post_time = datetime.fromisoformat(post_time.replace('Z', '+00:00'))
        elif not post_time:
            post_time = datetime.now(timezone.utc)

        try:
            # Analyze content using flow service
            result = await analysis_flow_service.analyze_content(
                text=text,
                image_urls=image_urls,
                user_id=user_id,
                user_history=user_history,
                post_time=post_time
            )

            # Create success document
            doc = EmotionAggregate(
                userId=user_id,
                targetId=target_id,
                targetType=target_type,
                content=text,
                imageUrls=image_urls,
                
                textEmotion=result.get("textEmotion"),
                imageEmotions=result.get("imageEmotions", []),
                finalEmotion=result.get("finalEmotion"),
                finalScores=result.get("finalScores"),
                intensity=result.get("intensity"),
                psychologicalRisk=result.get("psychologicalRisk"),
                recommendations=result.get("recommendations", []),
                moderation=result.get("moderation"),
                
                status=AnalysisStatusEnum.SUCCESS
            )

        except RetryableException as e:
            logger.warning(f"Retryable error during analysis: {e}")
            
            # Create failed document with retry scope
            doc = EmotionAggregate(
                userId=user_id,
                targetId=target_id,
                targetType=target_type,
                content=text,
                imageUrls=image_urls,
                status=AnalysisStatusEnum.FAILED,
                retryScope=RetryScopeEnum.FULL,
                retryCount=0,
                errorReason=str(e)
            )

        except Exception as e:
            logger.exception(f"Permanent error during analysis: {e}")
            
            # Create permanent failed document
            doc = EmotionAggregate(
                userId=user_id,
                targetId=target_id,
                targetType=target_type,
                content=text,
                imageUrls=image_urls,
                status=AnalysisStatusEnum.PERMANENT_FAILED,
                errorReason=str(e)
            )

        # Save to database
        return await self.repo.save_analysis(doc)

    async def handle_updated(self, event: dict) -> EmotionAggregate:
        """
        Handle content updated event.
        
        Args:
            event: Kafka event payload
            
        Returns:
            Updated EmotionAggregate document
        """
        target_id = event["targetId"]
        target_type = event["targetType"]
        new_text = event["content"]
        user_id = event["userId"]
        
        # Get existing analysis
        doc = await self.repo.get_analysis_by_target(target_id, target_type)
        if not doc:
            raise RetryableException("EmotionAggregate not found yet")
        
        # Fetch user history
        user_history = await self._fetch_user_history(user_id)

        try:
            # Analyze updated text
            result = await analysis_flow_service.analyze_text_only(
                text=new_text,
                user_id=user_id,
                user_history=user_history
            )

            # Update payload
            update_payload = {
                "content": new_text,
                "textEmotion": result.get("textEmotion"),
                "finalEmotion": result.get("finalEmotion"),
                "finalScores": result.get("finalScores"),
                "intensity": result.get("intensity"),
                "psychologicalRisk": result.get("psychologicalRisk"),
                "recommendations": result.get("recommendations", []),
                "moderation": result.get("moderation"),
                "status": AnalysisStatusEnum.SUCCESS,
                "errorReason": None,
                "updatedAt": datetime.now(timezone.utc)
            }

        except RetryableException as e:
            logger.warning(f"Retryable error during update: {e}")
            
            update_payload = {
                "content": new_text,
                "status": AnalysisStatusEnum.FAILED,
                "retryScope": RetryScopeEnum.TEXT_ONLY,
                "retryCount": 0,
                "errorReason": str(e),
                "updatedAt": datetime.now(timezone.utc)
            }

        except Exception as e:
            logger.exception(f"Permanent error during update: {e}")
            
            update_payload = {
                "status": AnalysisStatusEnum.PERMANENT_FAILED,
                "errorReason": str(e),
                "updatedAt": datetime.now(timezone.utc)
            }
        
        # Update in database
        updated = await self.repo.update_analysis(str(doc.id), update_payload)
        if not updated:
            raise RetryableException("Failed to update EmotionAggregate")

        return updated
    
    async def _fetch_user_history(self, user_id: str, limit: int = 30) -> List[Dict]:
        """
        Fetch user's recent emotion analysis history.
        
        Args:
            user_id: User ID
            limit: Maximum number of records to fetch
            
        Returns:
            List of recent analyses
        """
        try:
            history = await self.repo.get_user_recent_analyses(user_id, limit)
            
            # Transform to simplified format for risk scoring
            return [
                {
                    "emotion": item.finalEmotion,
                    "intensity": item.intensity.get("level") if item.intensity else "mild",
                    "timestamp": item.createdAt.isoformat() if item.createdAt else None
                }
                for item in history
                if item.finalEmotion
            ]
            
        except Exception as e:
            logger.error(f"Error fetching user history: {e}")
            return []


# Factory function to create instance with repository
def create_handle_event_service(repo: AnalysisRepository) -> HandleEventService:
    """
    Create HandleEventService instance.
    
    Args:
        repo: Analysis repository
        
    Returns:
        HandleEventService instance
    """
    return HandleEventService(repo)
