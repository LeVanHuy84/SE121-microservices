# app/services/orchestration/analysis_flow_service.py

"""
Application Service: Analysis Flow Orchestration
- Orchestrates emotion analysis flow
- Orchestrates moderation flow (SEPARATE from emotion)
- Integrates Domain Services and AI Layer
- Handles side-effects (DB, Kafka, Redis)
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

# Domain Services
from app.services.domain.emotion import emotion_analyzer
from app.services.domain.risk import risk_scorer
from app.services.domain.moderation import content_moderator

# AI Layer - Emotion
from app.services.ai.text_emotion import text_emotion_classifier
from app.services.ai.image_emotion import analyze_multiple_image_urls

# AI Layer - Moderation
from app.services.ai.text_moderation import phobert_moderator
from app.services.ai.image_moderation import moderate_multiple_image_urls
from app.services.ai.model_loader import model_loader

# Utils
from app.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)


class AnalysisFlowService:
    """
    Application service for orchestrating analysis flows.
    
    Architecture: Orchestration Layer
    - Coordinates Domain Services (business logic)
    - Calls AI Layer (model inference)
    - Manages flow sequencing
    - Handles errors and retries
    
    Key principle: Emotion analysis and moderation are SEPARATE concerns
    """

    async def analyze_content(
        self,
        text: str,
        image_urls: List[str],
        user_id: str = None,
        user_history: Optional[List[Dict]] = None,
        post_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Complete content analysis: emotion + moderation.
        
        Orchestrates:
        1. Text emotion analysis
        2. Image emotion analysis
        3. Emotion fusion and intensity
        4. Risk scoring
        5. Text moderation (keyword + PhoBERT)
        6. Image moderation (NSFW + Violence)
        7. Final moderation decision
        
        Args:
            text: Text content
            image_urls: List of image URLs
            user_id: User ID for context
            user_history: User's emotion history
            post_time: Post timestamp
            
        Returns:
            Complete analysis result with emotion and moderation
        """
        # Set default post time
        if not post_time:
            post_time = datetime.now(timezone.utc)
        elif isinstance(post_time, str):
            post_time = datetime.fromisoformat(post_time.replace('Z', '+00:00'))

        # ========================================
        # EMOTION ANALYSIS FLOW
        # ========================================
        
        # 1. TEXT EMOTION ANALYSIS
        text_emotion_result = text_emotion_classifier.classify(text)
        text_scores = text_emotion_result["emotionScores"]
        text_confidence = text_emotion_result.get("confidence", 0.8)

        # 2. IMAGE EMOTION ANALYSIS (if images present)
        image_emotion_results = []
        if image_urls:
            image_emotion_results = await analyze_multiple_image_urls(image_urls)
            
            # Check for retryable errors
            retryable_errors = [
                x for x in image_emotion_results 
                if x.get("error") and x.get("retryable")
            ]
            total = len(image_emotion_results)
            retry_ratio = len(retryable_errors) / total if total > 0 else 0
            
            if retry_ratio >= 0.4:
                raise RetryableException(
                    f"Retryable image emotion analysis ratio too high: {retry_ratio}"
                )

        # 3. EMOTION FUSION (Domain Logic)
        image_scores_avg = emotion_analyzer.average_image_scores(image_emotion_results)
        image_confidence = emotion_analyzer.get_average_image_confidence(image_emotion_results)
        
        final_scores = emotion_analyzer.fuse_emotions(
            text_scores=text_scores,
            image_scores=image_scores_avg,
            text_confidence=text_confidence,
            image_confidence=image_confidence
        )

        final_emotion = emotion_analyzer.get_dominant_emotion(final_scores)
        
        # 4. INTENSITY CALCULATION (Domain Logic)
        intensity = emotion_analyzer.calculate_intensity(final_scores)
        
        # 5. RISK SCORING (Domain Logic)
        dominant_scene = emotion_analyzer.get_dominant_scene_type(image_emotion_results)
        
        risk_assessment = risk_scorer.calculate_risk(
            emotion=final_emotion,
            intensity=intensity["level"],
            text=text,
            image_scene_type=dominant_scene,
            user_history=user_history,
            post_time=post_time
        )

        # ========================================
        # MODERATION FLOW (SEPARATE FROM EMOTION)
        # ========================================
        
        # 6. TEXT MODERATION
        # 6a. Keyword-based (legacy, fast)
        keyword_moderation = model_loader.check_content_violation(text)
        
        # 6b. PhoBERT-based (ML, semantic)
        phobert_moderation = phobert_moderator.moderate_text(text)
        
        # 6c. Aggregate text moderation (Domain Logic)
        text_moderation = content_moderator.aggregate_text_moderation(
            keyword_result=keyword_moderation,
            phobert_result=phobert_moderation
        )
        
        # 7. IMAGE MODERATION (if images present)
        image_moderation_results = []
        if image_urls:
            image_moderation_results = await moderate_multiple_image_urls(image_urls)
        
        # 7a. Aggregate image moderation (Domain Logic)
        image_moderation = content_moderator.aggregate_image_moderation(
            image_moderation_results
        )
        
        # 8. FINAL MODERATION DECISION (Domain Logic)
        final_moderation = content_moderator.make_final_moderation_decision(
            text_moderation=text_moderation,
            image_moderation=image_moderation
        )

        # ========================================
        # RETURN COMPLETE RESULT
        # ========================================
        
        return {
            # Emotion Analysis
            "textEmotion": text_emotion_result,
            "imageEmotions": image_emotion_results,
            "finalEmotion": final_emotion,
            "finalScores": final_scores,
            "intensity": intensity,
            "psychologicalRisk": risk_assessment,
            "recommendations": risk_assessment["recommendations"],
            
            # Moderation (separate concern)
            "moderation": final_moderation
        }

    async def analyze_text_only(
        self,
        text: str,
        user_id: str = None,
        user_history: Optional[List[Dict]] = None,
        post_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Analyze text only (for updates or text-only posts).
        
        Orchestrates:
        1. Text emotion analysis
        2. Intensity calculation
        3. Risk scoring
        4. Text moderation
        
        Args:
            text: Text content
            user_id: User ID for context
            user_history: User's emotion history
            post_time: Post timestamp
            
        Returns:
            Text-only analysis result
        """
        # Set default post time
        if not post_time:
            post_time = datetime.now(timezone.utc)

        # ========================================
        # EMOTION ANALYSIS
        # ========================================
        
        # TEXT EMOTION
        text_emotion_result = text_emotion_classifier.classify(text)
        text_scores = text_emotion_result["emotionScores"]
        
        final_emotion = emotion_analyzer.get_dominant_emotion(text_scores)
        
        # INTENSITY
        intensity = emotion_analyzer.calculate_intensity(text_scores)
        
        # RISK SCORING
        risk_assessment = risk_scorer.calculate_risk(
            emotion=final_emotion,
            intensity=intensity["level"],
            text=text,
            user_history=user_history,
            post_time=post_time
        )

        # ========================================
        # MODERATION
        # ========================================
        
        # Keyword + PhoBERT text moderation
        keyword_moderation = model_loader.check_content_violation(text)
        phobert_moderation = phobert_moderator.moderate_text(text)
        
        text_moderation = content_moderator.aggregate_text_moderation(
            keyword_result=keyword_moderation,
            phobert_result=phobert_moderation
        )
        
        # No images - text moderation is final moderation
        final_moderation = content_moderator.make_final_moderation_decision(
            text_moderation=text_moderation,
            image_moderation={
                "is_violation": False,
                "violations": [],
                "severity": "none",
                "safe": True
            }
        )

        return {
            # Emotion Analysis
            "textEmotion": text_emotion_result,
            "finalEmotion": final_emotion,
            "finalScores": text_scores,
            "intensity": intensity,
            "psychologicalRisk": risk_assessment,
            "recommendations": risk_assessment["recommendations"],
            
            # Moderation
            "moderation": final_moderation
        }


# Singleton instance
analysis_flow_service = AnalysisFlowService()
