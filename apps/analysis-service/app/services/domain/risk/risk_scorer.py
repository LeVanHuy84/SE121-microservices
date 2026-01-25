# app/services/domain/risk/risk_scorer.py

"""
Domain Service: Risk Scoring
- Thuần logic đánh giá rủi ro tâm lý
- Không phụ thuộc DB, Kafka, Redis
- Dễ unit test
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.enums.emotion_enum import EmotionEnum

logger = logging.getLogger(__name__)


class RiskScorer:
    """
    Domain service for psychological risk assessment.
    Pure business logic without infrastructure dependencies.
    """
    
    # Risk weights cho từng emotion
    EMOTION_RISK_WEIGHTS = {
        EmotionEnum.SADNESS: 0.7,
        EmotionEnum.ANGER: 0.5,
        EmotionEnum.FEAR: 0.6,
        EmotionEnum.DISGUST: 0.3,
        EmotionEnum.JOY: 0.0,
        EmotionEnum.SURPRISE: 0.1,
        EmotionEnum.NEUTRAL: 0.0,
    }
    
    # Từ khóa nguy hiểm
    CRITICAL_KEYWORDS = [
        'chết', 'tự tử', 'tự sát', 'kết thúc', 'vô vọng',
        'không muốn sống', 'mệt mỏi', 'bỏ cuộc', 'thất vọng',
        'cô đơn', 'không ai hiểu', 'buồn quá', 'trầm cảm'
    ]
    
    def calculate_risk(
        self,
        emotion: str,
        intensity: str,
        text: str = "",
        image_scene_type: str = "",
        user_history: Optional[List[Dict]] = None,
        post_time: Optional[datetime] = None
    ) -> dict:
        """
        Calculate comprehensive risk score.
        
        Args:
            emotion: Dominant emotion
            intensity: Emotion intensity level
            text: Text content
            image_scene_type: Scene type from images
            user_history: User's emotion history
            post_time: Post timestamp
            
        Returns:
            {
                "level": "low|medium|high|critical",
                "score": 0.0-1.0,
                "triggers": ["trigger1", "trigger2"],
                "recommendations": ["rec1", "rec2"]
            }
        """
        risk_score = 0.0
        triggers = []
        
        # 1. Base risk từ emotion
        emotion_enum = EmotionEnum(emotion) if emotion in [e.value for e in EmotionEnum] else EmotionEnum.NEUTRAL
        base_risk = self.EMOTION_RISK_WEIGHTS.get(emotion_enum, 0.0)
        risk_score += base_risk * 0.4  # 40% weight
        
        # 2. Intensity boost
        intensity_multiplier = {
            "mild": 1.0,
            "moderate": 1.3,
            "severe": 1.8
        }.get(intensity, 1.0)
        risk_score *= intensity_multiplier
        
        # 3. Critical keywords trong text
        text_lower = text.lower()
        critical_count = sum(1 for keyword in self.CRITICAL_KEYWORDS if keyword in text_lower)
        if critical_count > 0:
            risk_score += min(critical_count * 0.15, 0.4)  # Max +0.4
            triggers.append(f"critical_keywords_{critical_count}")
        
        # 4. Dark imagery
        if image_scene_type == "dark_scenery":
            risk_score += 0.1
            triggers.append("dark_imagery")
        
        # 5. User history pattern
        if user_history:
            history_risk = self._analyze_history_pattern(user_history)
            risk_score += history_risk * 0.3  # 30% weight
            if history_risk > 0.5:
                triggers.append("repeated_negative_pattern")
        
        # 6. Temporal pattern (late night posting)
        if post_time:
            hour = post_time.hour
            if 2 <= hour <= 5:  # 2-5 AM
                risk_score += 0.15
                triggers.append("late_night_posting")
        
        # Normalize score to 0-1
        risk_score = min(risk_score, 1.0)
        
        # Determine risk level
        level = self._determine_risk_level(risk_score)
        
        # Generate recommendations
        recommendations = self._generate_recommendations(level, triggers, emotion)
        
        return {
            "level": level,
            "score": round(risk_score, 3),
            "triggers": triggers,
            "recommendations": recommendations
        }
    
    def _analyze_history_pattern(self, history: List[Dict]) -> float:
        """
        Analyze patterns from user history.
        
        Args:
            history: List of recent posts with emotion
            
        Returns:
            risk_score: 0.0-1.0
        """
        if not history or len(history) < 3:
            return 0.0
        
        # Count negative emotions
        negative_emotions = [EmotionEnum.SADNESS, EmotionEnum.ANGER, EmotionEnum.FEAR]
        negative_count = sum(
            1 for item in history 
            if item.get("emotion") in [e.value for e in negative_emotions]
        )
        
        negative_ratio = negative_count / len(history)
        
        # Consecutive negative posts
        consecutive = 0
        max_consecutive = 0
        for item in history:
            if item.get("emotion") in [e.value for e in negative_emotions]:
                consecutive += 1
                max_consecutive = max(max_consecutive, consecutive)
            else:
                consecutive = 0
        
        # Risk calculation
        ratio_risk = negative_ratio * 0.6  # 60% weight
        consecutive_risk = min(max_consecutive / 5, 1.0) * 0.4  # 40% weight
        
        return ratio_risk + consecutive_risk
    
    def _determine_risk_level(self, risk_score: float) -> str:
        """
        Determine risk level from score.
        
        Args:
            risk_score: Risk score (0.0-1.0)
            
        Returns:
            Risk level string
        """
        if risk_score >= 0.75:
            return "critical"
        elif risk_score >= 0.5:
            return "high"
        elif risk_score >= 0.25:
            return "medium"
        else:
            return "low"
    
    def _generate_recommendations(
        self, 
        level: str, 
        triggers: List[str], 
        emotion: str
    ) -> List[str]:
        """
        Generate personalized recommendations based on risk.
        
        Args:
            level: Risk level
            triggers: List of risk triggers
            emotion: Dominant emotion
            
        Returns:
            List of recommendations
        """
        recommendations = []
        
        if level == "critical":
            recommendations.extend([
                "alert_support_team",
                "show_helpline_resources",
                "hide_triggering_content",
                "suggest_professional_help"
            ])
        elif level == "high":
            recommendations.extend([
                "show_uplifting_content",
                "suggest_community_support",
                "limit_sad_content_exposure"
            ])
        elif level == "medium":
            recommendations.extend([
                "show_positive_posts",
                "suggest_mindfulness_content"
            ])
        else:
            recommendations.append("normal_feed")
        
        # Specific recommendations based on triggers
        if "late_night_posting" in triggers:
            recommendations.append("suggest_sleep_tips")
        
        if "repeated_negative_pattern" in triggers:
            recommendations.append("suggest_journaling")
        
        return recommendations


# Singleton instance
risk_scorer = RiskScorer()
