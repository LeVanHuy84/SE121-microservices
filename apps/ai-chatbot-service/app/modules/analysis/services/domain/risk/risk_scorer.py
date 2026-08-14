# app/services/domain/risk/risk_scorer.py

"""
Domain Service: Risk Hint Detection
- Keyword-based risk hint ONLY
- NO user history analysis
- NO longitudinal patterns
- NO numeric risk scoring
- Output: RiskHintLevelEnum (NONE | WEAK | MEDIUM | HIGH)
"""

import logging
from app.modules.analysis.enums import RiskHintLevelEnum

logger = logging.getLogger(__name__)


class RiskScorer:
    """
    Domain service for keyword-based risk hint detection.
    
    Architecture: Domain Layer
    - Simple keyword matching for risk signals
    - NO deep analysis, NO user history
    - Output is hint level only
    - Full risk pipeline is separate (out of scope)
    """
    
    # Critical risk keywords (high severity)
    CRITICAL_KEYWORDS = [
        'tự tử', 'tự sát', 'tự vẫn', 'kết thúc cuộc đời',
        'không muốn sống', 'chết đi', 'tự kết liễu'
    ]
    
    # Medium risk keywords
    MEDIUM_RISK_KEYWORDS = [
        'vô vọng', 'bỏ cuộc', 'thất vọng', 'trầm cảm',
        'tuyệt vọng', 'không còn hy vọng', 'chán nản'
    ]
    
    # Weak risk keywords
    WEAK_RISK_KEYWORDS = [
        'buồn', 'cô đơn', 'mệt mỏi', 'không ai hiểu',
        'buồn quá', 'stress', 'căng thẳng'
    ]
    
    def detect_risk_hint(self, text: str, emotion: str, intensity: str) -> RiskHintLevelEnum:
        """
        Detect risk hint level from text keywords and emotion context.
        
        SCOPE: Keyword-based hint ONLY
        - NO user history
        - NO longitudinal analysis
        - NO numeric scoring
        
        Args:
            text: Text content
            emotion: Dominant emotion
            intensity: Emotion intensity level
            
        Returns:
            RiskHintLevelEnum: NONE | WEAK | MEDIUM | HIGH
        """
        if not text:
            return RiskHintLevelEnum.NONE
        
        text_lower = text.lower()
        
        # Check critical keywords - immediate HIGH risk hint
        if self._contains_keywords(text_lower, self.CRITICAL_KEYWORDS):
            return RiskHintLevelEnum.HIGH
        
        # Check medium risk keywords
        has_medium = self._contains_keywords(text_lower, self.MEDIUM_RISK_KEYWORDS)
        
        # Check weak risk keywords
        has_weak = self._contains_keywords(text_lower, self.WEAK_RISK_KEYWORDS)
        
        # Combine with emotion context
        negative_emotions = ['sadness', 'fear', 'anger']
        is_negative = emotion in negative_emotions
        is_severe = intensity == 'severe'
        
        # Decision logic
        if has_medium and is_negative and is_severe:
            return RiskHintLevelEnum.HIGH
        
        if has_medium and is_negative:
            return RiskHintLevelEnum.MEDIUM
        
        if has_medium or (has_weak and is_severe):
            return RiskHintLevelEnum.MEDIUM
        
        if has_weak and is_negative:
            return RiskHintLevelEnum.WEAK
        
        if has_weak:
            return RiskHintLevelEnum.WEAK
        
        return RiskHintLevelEnum.NONE
    
    def _contains_keywords(self, text: str, keywords: list) -> bool:
        """Check if text contains any keyword from list."""
        return any(keyword in text for keyword in keywords)


# Singleton instance
risk_scorer = RiskScorer()
