# app/services/ai/text_emotion/phobert_emotion_model.py

"""
PhoBERT Emotion Model - Vietnamese Text Emotion Classification
- Loads and manages PhoBERT emotion model
- Provides inference interface
- Owned by text_emotion subdomain
"""

import logging
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification, pipeline

logger = logging.getLogger(__name__)


class PhoBERTEmotionModel:
    """
    PhoBERT model for Vietnamese text emotion classification.
    
    Architecture: AI Layer - Model management
    - Owns the PhoBERT emotion model instance
    - Handles loading, initialization, inference
    - Separate from PhoBERT moderation (different model)
    """
    
    _instance_initialized = False
    
    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.pipeline = None
        self.device = None
    
    def initialize(self):
        """Initialize PhoBERT emotion model."""
        if self._instance_initialized:
            return
        
        try:
            model_name = "visolex/phobert-emotion"
            
            logger.info(f"[PhoBERTEmotion] Loading model: {model_name}")
            
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            self.model = AutoModelForSequenceClassification.from_pretrained(model_name)
            
            self.pipeline = pipeline(
                "text-classification",
                model=self.model,
                tokenizer=self.tokenizer,
                return_all_scores=True
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
