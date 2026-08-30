# app/services/ai/text_emotion/phobert_emotion_model.py

"""
PhoBERT Emotion Model - Vietnamese Text Emotion Classification
- Loads and manages PhoBERT emotion model
- Provides inference interface
- Owned by text_emotion subdomain
"""

import os
from pathlib import Path
import logging
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline

logger = logging.getLogger(__name__)

# Preferred Model Sources: Env Var -> Local evaluation weights (if exists) -> Hugging Face Hub
DEFAULT_LOCAL_WEIGHTS = Path(__file__).parents[6] / "evaluation" / "weights" / "phobert_emotion_final"
HF_HUB_MODEL_NAME = "huyleit/phobert-emotion-social"


class PhoBERTEmotionModel:
    """
    PhoBERT model for Vietnamese text emotion classification.
    
    Architecture: AI Layer - Model management
    - Owns the PhoBERT emotion model instance (huyleit/phobert-emotion-social)
    - Handles loading, initialization, inference
    - Separate from PhoBERT moderation (different model)
    """
    
    _instance_initialized = False
    
    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.pipeline = None
        self.device = None
        
        env_model_path = os.getenv("PHOBERT_EMOTION_MODEL_PATH")
        if env_model_path:
            self.model_name = env_model_path
        elif DEFAULT_LOCAL_WEIGHTS.exists():
            self.model_name = str(DEFAULT_LOCAL_WEIGHTS)
        else:
            self.model_name = HF_HUB_MODEL_NAME
    
    def initialize(self):
        """Initialize PhoBERT emotion model."""
        if self._instance_initialized:
            return
        
        try:            
            logger.info(f"[PhoBERTEmotion] Loading model: {self.model_name}")
            
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self.model = AutoModelForSequenceClassification.from_pretrained(self.model_name)
            
            self.pipeline = pipeline(
                "text-classification",
                model=self.model,
                tokenizer=self.tokenizer,
                top_k=None
            )
            
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model = self.model.to(self.device)
            
            logger.info(f"[PhoBERTEmotion] Model loaded successfully on {self.device}")
            self._instance_initialized = True
            
        except Exception as e:
            logger.error(f"[PhoBERTEmotion] Failed to load model: {e}")
            raise RuntimeError(f"PhoBERT emotion model loading failed: {e}")
    
    def is_loaded(self) -> bool:
        """Check if model is loaded."""
        return self._instance_initialized
    
    def get_tokenizer(self):
        """Get tokenizer instance."""
        if not self._instance_initialized:
            raise RuntimeError("PhoBERT emotion model not initialized. Call initialize() first.")
        return self.tokenizer
    
    def get_model(self):
        """Get model instance."""
        if not self._instance_initialized:
            raise RuntimeError("PhoBERT emotion model not initialized. Call initialize() first.")
        return self.model
    
    def get_model_name(self) -> str:
        """Get model name."""
        return self.model_name
    
    def get_pipeline(self):
        """Get pipeline instance."""
        if not self._instance_initialized:
            raise RuntimeError("PhoBERT emotion model not initialized. Call initialize() first.")
        return self.pipeline


# Singleton instance
phobert_emotion_model = PhoBERTEmotionModel()


def ensure_phobert_emotion_loaded():
    """Ensure PhoBERT emotion model is loaded."""
    if not phobert_emotion_model._instance_initialized:
        phobert_emotion_model.initialize()
