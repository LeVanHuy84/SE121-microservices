# app/services/domain/moderation/content_moderator.py

"""
Domain Service: Content Moderation
- Pure business logic for moderation decisions
- Aggregates AI moderation results
- Applies moderation policies
- No direct ML model dependencies
"""

import logging
from typing import Dict

logger = logging.getLogger(__name__)


class ContentModerator:
    """
    Domain service for content moderation business logic.
    
    Architecture: Domain Layer
    - Contains business rules and policies
    - No direct AI model dependencies
    - Aggregates results from AI layer
    - Makes final moderation decisions
    """
    
    def aggregate_text_moderation(
        self, 
        keyword_result: dict, 
        phobert_result: dict = None
    ) -> dict:
        """
        Aggregate text moderation results from multiple sources.
        
        Business logic:
        - Combines keyword-based and ML-based moderation
        - Applies voting/confidence weighting
        - Makes final violation decision
        
        Args:
            keyword_result: Result from keyword-based moderation
            phobert_result: Result from PhoBERT moderation (optional)
            
        Returns:
            Aggregated moderation result
        """
        # If only keyword result available
        if not phobert_result:
            return self._enhance_keyword_result(keyword_result)
        
        # Both sources available - aggregate
        is_violation_keyword = keyword_result.get("is_violation", False)
        is_violation_phobert = phobert_result.get("is_violation", False)
        
        # Business rule: If either flags violation, consider it a violation
        # (can be adjusted based on confidence)
        is_violation = is_violation_keyword or is_violation_phobert
        
        # Aggregate violations
        violations = set()
        violations.update(keyword_result.get("violations", []))
        
        if phobert_result.get("category") not in ["safe", "unknown"]:
            violations.add(phobert_result["category"])
        
        # Determine severity
        severity = self._calculate_text_severity(
            keyword_result,
            phobert_result,
            is_violation
        )
        
        # Generate recommendations
        action = self._determine_action(severity)
        
        return {
            "is_violation": is_violation,
            "violations": list(violations),
            "severity": severity,
            "safe": not is_violation,
            "action": action,
            "sources": {
                "keyword": keyword_result,
                "phobert": phobert_result
            },
            "model": "aggregated_text_moderation"
        }
    
    def aggregate_image_moderation(self, image_moderation_results: list) -> dict:
        """
        Aggregate image moderation results for multiple images.
        
        Business logic:
        - Checks all images in a post
        - Flags post if ANY image violates
        - Determines overall severity
        
        Args:
            image_moderation_results: List of per-image moderation results
            
        Returns:
            Aggregated image moderation result
        """
        if not image_moderation_results:
            return {
                "is_violation": False,
                "violations": [],
                "severity": "none",
                "safe": True,
                "action": "allow",
                "image_count": 0
            }
        
        # Filter out errors
        valid_results = [
            r for r in image_moderation_results 
            if not r.get("error")
        ]
        
        if not valid_results:
            return {
                "is_violation": False,
                "violations": [],
                "severity": "none",
                "safe": True,
                "action": "allow",
                "image_count": 0,
                "note": "all_images_failed_analysis"
            }
        
        # Business rule: Post violates if ANY image violates
        violations = []
        max_severity = "none"
        
        for result in valid_results:
            if result.get("is_violation"):
                violations.extend(result.get("violations", []))
                
                # Track highest severity
                img_severity = result.get("severity", "none")
                if self._severity_level(img_severity) > self._severity_level(max_severity):
                    max_severity = img_severity
        
        is_violation = bool(violations)
        action = self._determine_action(max_severity)
        
        return {
            "is_violation": is_violation,
            "violations": list(set(violations)),  # unique violations
            "severity": max_severity,
            "safe": not is_violation,
            "action": action,
            "image_count": len(valid_results),
            "violation_count": sum(1 for r in valid_results if r.get("is_violation")),
            "details": valid_results
        }
    
    def make_final_moderation_decision(
        self,
        text_moderation: dict,
        image_moderation: dict
    ) -> dict:
        """
        Make final moderation decision combining text and image moderation.
        
        Business logic:
        - Combines text and image moderation
        - Applies overall policy
        - Determines final action
        
        Args:
            text_moderation: Aggregated text moderation result
            image_moderation: Aggregated image moderation result
            
        Returns:
            Final moderation decision
        """
        # Combine violations
        all_violations = set()
        all_violations.update(text_moderation.get("violations", []))
        all_violations.update(image_moderation.get("violations", []))
        
        # Determine if content violates
        is_violation = (
            text_moderation.get("is_violation", False) or
            image_moderation.get("is_violation", False)
        )
        
        # Determine overall severity (take max)
        text_sev = text_moderation.get("severity", "none")
        image_sev = image_moderation.get("severity", "none")
        
        overall_severity = text_sev if self._severity_level(text_sev) > self._severity_level(image_sev) else image_sev
        
        # Determine action
        action = self._determine_action(overall_severity)
        
        return {
            "is_violation": is_violation,
            "violations": list(all_violations),
            "severity": overall_severity,
            "safe": not is_violation,
            "action": action,
            "text_moderation": text_moderation,
            "image_moderation": image_moderation
        }
    
    # -------------------------
    # Helper Methods
    # -------------------------
    
    def _enhance_keyword_result(self, keyword_result: dict) -> dict:
        """Add severity and action to keyword-only result."""
        violations = keyword_result.get("violations", [])
        severity = self._calculate_keyword_severity(violations)
        action = self._determine_action(severity)
        
        return {
            **keyword_result,
            "severity": severity,
            "action": action
        }
    
    def _calculate_text_severity(
        self,
        keyword_result: dict,
        phobert_result: dict,
        is_violation: bool
    ) -> str:
        """Calculate text moderation severity."""
        if not is_violation:
            return "none"
        
        # Check for critical keywords
        keyword_violations = keyword_result.get("violations", [])
        if "self_harm" in keyword_violations or "violence" in keyword_violations:
            return "high"
        
        # Check PhoBERT confidence
        if phobert_result:
            phobert_category = phobert_result.get("category", "")
            phobert_conf = phobert_result.get("confidence", 0.0)
            
            if phobert_category in ["toxic", "hate_speech"] and phobert_conf > 0.8:
                return "high"
            
            if phobert_category == "sexual":
                return "high"
        
        # Medium severity
        if len(keyword_violations) >= 2:
            return "medium"
        
        return "low"
    
    def _calculate_keyword_severity(self, violations: list) -> str:
        """Calculate severity from keyword violations."""
        if not violations:
            return "none"
        
        if "self_harm" in violations or "violence" in violations:
            return "high"
        
        if "sexual" in violations or "hate_speech" in violations:
            return "high"
        
        if len(violations) >= 2:
            return "medium"
        
        return "low"
    
    def _severity_level(self, severity: str) -> int:
        """Convert severity to numeric level for comparison."""
        levels = {
            "none": 0,
            "low": 1,
            "medium": 2,
            "high": 3
        }
        return levels.get(severity, 0)
    
    def _determine_action(self, severity: str) -> str:
        """
        Determine moderation action based on severity.
        
        Business policy:
        - high: block content immediately
        - medium: flag for review
        - low: allow with warning
        - none: allow
        """
        action_map = {
            "high": "block",
            "medium": "review",
            "low": "warn",
            "none": "allow"
        }
        return action_map.get(severity, "allow")


# Singleton instance
content_moderator = ContentModerator()
