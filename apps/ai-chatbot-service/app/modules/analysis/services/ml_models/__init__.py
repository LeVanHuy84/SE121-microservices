# app/modules/analysis/services/ml_models/__init__.py

"""
AI Layer - ML Models Registry & Coordinators
- Text Emotion: PhoBERT Multi-label (7 Ekman classes)
- Text Moderation: PhoBERT Moderator + Keyword Moderator
- Music Emotion: Librosa + PyTorch Audio Classifier
- Multimodal (Text + Image): Unified VLM Pipeline (Groq API / OpenAI Compatible)
"""

from .model_loader import model_loader, ensure_models_loaded
from .text_emotion import text_emotion_classifier
from .text_moderation import phobert_moderator, ensure_phobert_moderator_loaded
from .vlm import vlm_analyzer, VLMAnalyzer

__all__ = [
    # Core model loader
    "model_loader",
    "ensure_models_loaded",
    
    # Text Emotion (PhoBERT)
    "text_emotion_classifier",
    
    # Text Moderation (PhoBERT)
    "phobert_moderator",
    "ensure_phobert_moderator_loaded",
    
    # Multimodal VLM
    "vlm_analyzer",
    "VLMAnalyzer",
]
