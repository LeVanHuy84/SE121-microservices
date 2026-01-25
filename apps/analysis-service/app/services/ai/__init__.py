# app/services/ai/__init__.py

"""
AI Layer - Model loading and inference
All ML model-related code resides here.
No business logic - only model inference.
"""

from .model_loader import model_loader, ensure_models_loaded

# Text Emotion
from .text_emotion import text_emotion_classifier

# Image Emotion (FER-based)
from .image_emotion import analyze_multiple_image_urls, fer_analyzer, ensure_fer_loaded

# Text Moderation (PhoBERT-based)
from .text_moderation import phobert_moderator, ensure_phobert_moderator_loaded

# Image Moderation (NSFW + Violence)
from .image_moderation import (
    nsfw_detector,
    violence_detector,
    moderate_multiple_image_urls,
    ensure_nsfw_detector_loaded,
    ensure_violence_detector_loaded
)

__all__ = [
    # Core model loader
    'model_loader',
    'ensure_models_loaded',
    
    # Text Emotion
    'text_emotion_classifier',
    
    # Image Emotion
    'analyze_multiple_image_urls',
    'fer_analyzer',
    'ensure_fer_loaded',
    
    # Text Moderation
    'phobert_moderator',
    'ensure_phobert_moderator_loaded',
    
    # Image Moderation
    'nsfw_detector',
    'violence_detector',
    'moderate_multiple_image_urls',
    'ensure_nsfw_detector_loaded',
    'ensure_violence_detector_loaded'
]
