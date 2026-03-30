# app/services/ai/model_loader.py
"""
AI Model Loader - Central Bootstrapper & Coordinator
- NO direct model loading
- Coordinates initialization of all AI subdomain models
- Provides centralized startup/health check
"""

import logging

logger = logging.getLogger(__name__)


class ModelLoader:
    """
    Central model loader coordinator.
    
    Architecture: AI Layer - Bootstrap Coordinator
    - Does NOT own any models directly
    - Coordinates model loading from subdomains:
      * image_understanding (CLIP)
      * text_emotion (PhoBERT emotion)
      * image_emotion (FER)
      * text_moderation (PhoBERT moderation)
      * image_moderation (NSFW, Violence via CLIP)
    - Fail-fast on critical model failures
    - Provides unified initialization interface
    
    Each subdomain loads its own models.
    """

    _instance_initialized = False

    def __init__(self):
        # No model instances stored here
        # This class only coordinates
        pass
    
    def initialize(self):
        """
        Initialize all AI models across subdomains.
        Coordinates loading in proper order.
        """
        if self._instance_initialized:
            logger.info("[ModelLoader] Already initialized")
            return

        logger.info("[ModelLoader] Starting model initialization...")
        
        # Load CLIP (Image Understanding) - FIRST for image tasks
        try:
            from app.services.ai.image_understanding import ensure_clip_loaded
            ensure_clip_loaded()
            logger.info("[ModelLoader] ✓ CLIP image understanding loaded")
        except Exception as e:
            logger.error(f"[ModelLoader] ✗ CLIP failed to load: {e}")
            # CLIP is critical for violence detection - raise error
            raise RuntimeError("Critical: CLIP model failed to load") from e
        
        # Load Text Emotion models
        try:
            from app.services.ai.text_emotion import ensure_phobert_emotion_loaded
            ensure_phobert_emotion_loaded()
            logger.info("[ModelLoader] ✓ Text emotion models loaded")
        except Exception as e:
            logger.error(f"[ModelLoader] ✗ Failed to load text emotion models: {e}")
            raise RuntimeError("Critical: Text emotion models failed to load") from e
        
        # Load Image Emotion models (FER)
        try:
            from app.services.ai.image_emotion import ensure_fer_loaded
            ensure_fer_loaded()
            logger.info("[ModelLoader] ✓ FER image emotion loaded")
        except Exception as e:
            logger.warning(f"[ModelLoader] ⚠ FER models failed: {e}")
            # Non-critical - CLIP can handle scene emotion
        
        # Load Text Moderation models
        try:
            from app.services.ai.text_moderation import ensure_phobert_moderator_loaded
            ensure_phobert_moderator_loaded()
            logger.info("[ModelLoader] ✓ Text moderation models loaded")
        except Exception as e:
            logger.warning(f"[ModelLoader] ⚠ Text moderation models failed: {e}")
            # Non-critical - will use keyword fallback
        
        self._instance_initialized = True
        logger.info("[ModelLoader] ✓ All model initialization complete")
    
    def is_initialized(self) -> bool:
        """Check if initialization complete."""
        return self._instance_initialized
    
    def health_check(self) -> dict:
        """
        Check health status of all AI subdomain models.
        
        Returns:
            Dictionary with status of each subdomain
        """
        status = {
            "initialized": self._instance_initialized,
            "clip": False,
            "text_emotion": False,
            "image_emotion": False,
            "text_moderation": False,
            "image_moderation": False
        }
        
        if not self._instance_initialized:
            return status
        
        try:
            from app.services.ai.image_understanding import clip_loader
            status["clip"] = clip_loader.is_loaded()
        except Exception:
            pass
        
        try:
            from app.services.ai.text_emotion import phobert_emotion_model
            status["text_emotion"] = phobert_emotion_model.is_loaded()
        except Exception:
            pass
        
        try:
            from app.services.ai.image_emotion import fer_analyzer
            status["image_emotion"] = fer_analyzer._instance_initialized
        except Exception:
            pass
        
        try:
            from app.services.ai.text_moderation import phobert_moderator
            status["text_moderation"] = phobert_moderator._instance_initialized
        except Exception:
            pass
        
        try:
            from app.services.ai.image_moderation import unsafe_scene_detector
            status["image_moderation"] = (
                unsafe_scene_detector._instance_initialized
            )
        except Exception:
            pass
        
        return status


# Singleton instance
model_loader = ModelLoader()


def ensure_models_loaded():
    """
    Ensure all AI models are loaded and ready.
    This is the main entry point for model initialization.
    """
    if not model_loader._instance_initialized:
        model_loader.initialize()


def get_model_health():
    """Get health status of all models."""
    return model_loader.health_check()
