# app/modules/analysis/services/ml_models/__init__.py

"""
AI Layer - ML Models Registry & Coordinators
- Text Emotion: PhoBERT Multi-label (7 Ekman classes) ONNX FP32
- Text Moderation: PhoBERT Moderator ONNX INT8 + Keyword Moderator
- Music Emotion: MERT Transformer ONNX INT8
- Multimodal (Text + Image): Unified VLM Pipeline (Groq LPUs API Vision Pipeline)
"""

from .model_loader import model_loader, ensure_models_loaded, get_model_health
from .text_emotion import text_emotion_classifier
from .text_moderation import phobert_moderator, ensure_phobert_moderator_loaded
from .music import music_emotion_analyzer
from .vlm import vlm_analyzer, VLMAnalyzer

__all__ = [
    # Core model loader
    "model_loader",
    "ensure_models_loaded",
    "get_model_health",
    
    # Text Emotion (PhoBERT ONNX FP32)
    "text_emotion_classifier",
    
    # Text Moderation (PhoBERT ONNX INT8)
    "phobert_moderator",
    "ensure_phobert_moderator_loaded",

    # Music Emotion (MERT ONNX INT8)
    "music_emotion_analyzer",
    
    # Multimodal VLM
    "vlm_analyzer",
    "VLMAnalyzer",
]
