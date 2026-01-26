# app/services/ai/image_understanding/clip_loader.py

"""
CLIP Model Loader - Singleton pattern for CLIP model management
- Loads OpenAI CLIP model (ViT-B/32)
- Provides model + processor/tokenizer
- NO inference logic (pure model loading)
"""

import logging
import torch
from transformers import CLIPProcessor, CLIPModel

logger = logging.getLogger(__name__)


class CLIPLoader:
    """
    CLIP Model Loader - Singleton
    
    Architecture: AI Layer - Model Loading Only
    - Loads CLIP model and processor
    - CPU by default, optional CUDA
    - No inference, no business logic
    - Thread-safe initialization
    """
    
    _instance_initialized = False
    
    def __init__(self):
        self.model = None
        self.processor = None
        self.device = None
    
    def initialize(self, model_name: str = "openai/clip-vit-base-patch32"):
        """
        Initialize CLIP model and processor.
        
        Args:
            model_name: HuggingFace model ID (default: openai/clip-vit-base-patch32)
        """
        if self._instance_initialized:
            logger.info("[CLIPLoader] Already initialized")
            return
        
        try:
            logger.info(f"[CLIPLoader] Loading CLIP model: {model_name}")
            
            # Determine device
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            logger.info(f"[CLIPLoader] Using device: {self.device}")
            
            # Load model and processor
            self.model = CLIPModel.from_pretrained(model_name)
            self.processor = CLIPProcessor.from_pretrained(model_name)
            
            # Move model to device
            self.model = self.model.to(self.device)
            self.model.eval()
            self.model.requires_grad_(False)
            
            self._instance_initialized = True
            logger.info("[CLIPLoader] ✓ CLIP model loaded successfully")
            
        except Exception as e:
            logger.error(f"[CLIPLoader] ✗ Failed to load CLIP model: {e}")
            raise RuntimeError(f"CLIP model loading failed: {e}") from e
    
    def is_loaded(self) -> bool:
        """Check if CLIP model is loaded and ready."""
        return self._instance_initialized and self.model is not None
    
    def get_model(self):
        """Get CLIP model instance."""
        if not self.is_loaded():
            raise RuntimeError("CLIP model not loaded. Call initialize() first.")
        return self.model
    
    def get_processor(self):
        """Get CLIP processor instance."""
        if not self.is_loaded():
            raise RuntimeError("CLIP processor not loaded. Call initialize() first.")
        return self.processor
    
    def get_device(self) -> str:
        """Get current device (cpu/cuda)."""
        return self.device if self.device else "cpu"


# Singleton instance
clip_loader = CLIPLoader()


def ensure_clip_loaded():
    """
    Ensure CLIP model is loaded and ready.
    Safe to call multiple times (idempotent).
    """
    if not clip_loader._instance_initialized:
        clip_loader.initialize()
