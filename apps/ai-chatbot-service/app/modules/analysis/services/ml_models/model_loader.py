# app/modules/analysis/services/ml_models/model_loader.py
"""
AI Model Loader - Central Bootstrapper & Coordinator
- Coordinates initialization of active AI subdomain models:
  * text_emotion (PhoBERT 7 Ekman multi-label)
  * text_moderation (PhoBERT moderation)
  * vlm (Groq LPUs API Vision Pipeline)
- Fast startup (< 3s)
"""

import logging

logger = logging.getLogger(__name__)


class ModelLoader:
    """
    Central model loader coordinator.
    Architecture: AI Layer - Bootstrap Coordinator
    - Coordinates model loading from subdomains:
      * text_emotion (PhoBERT 7 Ekman multi-label)
      * text_moderation (PhoBERT moderation + Keywords)
      * vlm (Unified Multimodal VLM)
    """

    _instance_initialized = False

    def __init__(self):
        pass
    
    def initialize(self):
        """
        Initialize active AI models across subdomains.
        """
        if self._instance_initialized:
            logger.info("[ModelLoader] Already initialized")
            return

        logger.info("[ModelLoader] Starting model initialization...")
        
        # 1. Load Text Emotion models (PhoBERT)
        try:
            from app.modules.analysis.services.ml_models.text_emotion.phobert_emotion_model import phobert_emotion_model
            phobert_emotion_model.initialize()
            logger.info("[ModelLoader] ✓ Text emotion (PhoBERT) models loaded")
        except Exception as e:
            logger.error(f"[ModelLoader] ✗ Failed to load text emotion models: {e}")
            raise RuntimeError("Critical: Text emotion models failed to load") from e
        
        # 2. Load Text Moderation models (PhoBERT Moderator)
        try:
            from app.modules.analysis.services.ml_models.text_moderation import ensure_phobert_moderator_loaded
            ensure_phobert_moderator_loaded()
            logger.info("[ModelLoader] ✓ Text moderation models loaded")
        except Exception as e:
            logger.warning(f"[ModelLoader] ⚠ Text moderation models failed: {e}")

        # 3. Check VLM Pipeline readiness
        try:
            from app.modules.analysis.services.ml_models.vlm import vlm_analyzer
            logger.info(f"[ModelLoader] ✓ VLM Multimodal Analyzer ready (Model: {vlm_analyzer.model_name})")
        except Exception as e:
            logger.warning(f"[ModelLoader] ⚠ VLM Analyzer init check: {e}")
        
        self._instance_initialized = True
        logger.info("[ModelLoader] ✓ All active model initialization complete")
    
    def is_initialized(self) -> bool:
        """Check if initialization complete."""
        return self._instance_initialized
    
    def health_check(self) -> dict:
        """
        Check health status of all AI subdomain models.
        """
        status = {
            "initialized": self._instance_initialized,
            "text_emotion": False,
            "text_moderation": False,
            "vlm_multimodal": False,
        }
        
        if not self._instance_initialized:
            return status
        
        try:
            from app.modules.analysis.services.ml_models.text_emotion.phobert_emotion_model import phobert_emotion_model
            status["text_emotion"] = phobert_emotion_model.is_loaded()
        except Exception:
            pass
        
        try:
            from app.modules.analysis.services.ml_models.text_moderation import phobert_moderator
            status["text_moderation"] = phobert_moderator._instance_initialized
        except Exception:
            pass

        try:
            from app.modules.analysis.services.ml_models.vlm import vlm_analyzer
            status["vlm_multimodal"] = bool(vlm_analyzer.api_key)
        except Exception:
            pass
        
        return status


# Singleton instance
model_loader = ModelLoader()


def ensure_models_loaded():
    """Ensure all AI models are loaded and ready."""
    if not model_loader._instance_initialized:
        model_loader.initialize()


def get_model_health():
    """Get health status of all models."""
    return model_loader.health_check()
