# app/services/ai/__init__.py

"""
AI Layer - Model loading and inference
All ML model-related code resides here.
No business logic - only model inference.
"""

from .model_loader import model_loader, ensure_models_loaded

# Image Understanding (CLIP-based)
from .image_understanding import clip_loader, clip_analyzer, ensure_clip_loaded

# Text Emotion
from .text_emotion import text_emotion_classifier

# Image Emotion (FER-based)
from .image_emotion import analyze_multiple_image_urls, fer_analyzer, ensure_fer_loaded

# Text Moderation (PhoBERT-based)
from .text_moderation import phobert_moderator, ensure_phobert_moderator_loaded

# Image Moderation (NSFW + Violence)
from .image_moderation import (
    moderate_single_image_url,
    moderate_multiple_image_urls,
    ensure_unsafe_scene_detector_loaded
)

__all__ = [
    # Core model loader
    'model_loader',
    'ensure_models_loaded',
    
    # Image Understanding (CLIP)
    'clip_loader',
    'clip_analyzer',
    'ensure_clip_loaded',
    
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
    'moderate_single_image_url',
    'moderate_multiple_image_urls',
    'ensure_unsafe_scene_detector_loaded'
]
