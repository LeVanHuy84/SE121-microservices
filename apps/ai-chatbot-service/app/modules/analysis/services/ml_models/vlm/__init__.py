# app/modules/analysis/services/ml_models/vlm/__init__.py

"""
VLM Subdomain Module - Unified Multimodal Vision Language Model Pipeline
- 7 Ekman Emotion Multi-label Classification
- Multimodal Sarcasm & Conflict Detection
- Integrated Content Moderation (NSFW, Violence, Self-harm)
- Native Multi-Image Input Payload
"""

from .vlm_analyzer import vlm_analyzer, VLMAnalyzer

__all__ = [
    "vlm_analyzer",
    "VLMAnalyzer",
]
