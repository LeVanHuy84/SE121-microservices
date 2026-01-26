# app/services/ai/image_understanding/__init__.py

"""
Image Understanding Module - CLIP-based semantic understanding
- Violence/unsafe scene detection
- Scene-level emotion analysis
"""

from .clip_loader import clip_loader, ensure_clip_loaded
from .clip_analyzer import clip_analyzer
from .clip_prompts import (
    get_negative_semantic_prompts,
    get_emotion_prompts,
    flatten_prompts
)

__all__ = [
    'clip_loader',
    'ensure_clip_loaded',
    'clip_analyzer',
    'get_negative_semantic_prompts',
    'get_emotion_prompts',
    'flatten_prompts',
]
