import os
import logging
from pathlib import Path
import onnxruntime as ort
from transformers import AutoTokenizer
from huggingface_hub import hf_hub_download

from app.core.settings import settings

logger = logging.getLogger(__name__)


class PhoBERTEmotionModel:
    """
    PhoBERT model for Vietnamese text emotion classification using ONNX Runtime FP32.
    
    Architecture: AI Layer - Model management
    - Owns the PhoBERT ONNX emotion model session
    - Handles loading, initialization, session management
    - 7 Ekman Emotion Classes
    """
    
    _instance_initialized = False
    
    def __init__(self):
        self.tokenizer = None
        self.session = None
        self.model_name = settings.PHOBERT_EMOTION_MODEL_PATH
        self.onnx_model_path = None

    def _resolve_model_path(self) -> str:
        """Resolve local ONNX weight file or download from Hugging Face Hub."""
        if settings.PHOBERT_EMOTION_ONNX_PATH and os.path.exists(settings.PHOBERT_EMOTION_ONNX_PATH):
            return settings.PHOBERT_EMOTION_ONNX_PATH

        candidate_paths = [
            Path(__file__).resolve().parents[7] / "evaluation" / "weights" / "phobert_emotion_fp32.onnx",
            Path("evaluation/weights/phobert_emotion_fp32.onnx").resolve(),
            Path("../evaluation/weights/phobert_emotion_fp32.onnx").resolve(),
            Path("../../evaluation/weights/phobert_emotion_fp32.onnx").resolve(),
        ]
        for p in candidate_paths:
            if p.exists():
                return str(p)

        logger.info(f"[PhoBERTEmotion] Downloading ONNX FP32 model from Hugging Face Hub ({self.model_name})...")
        downloaded = hf_hub_download(
            repo_id=self.model_name,
            filename="phobert_emotion_fp32.onnx",
            subfolder="onnx"
        )
        return downloaded
    
    def initialize(self):
        """Initialize PhoBERT emotion ONNX model."""
        if self._instance_initialized:
            return
        
        try:            
            self.onnx_model_path = self._resolve_model_path()
            logger.info(f"[PhoBERTEmotion] Loading ONNX FP32 emotion model from: {self.onnx_model_path}")
            
            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            
            self.session = ort.InferenceSession(self.onnx_model_path, opts, providers=["CPUExecutionProvider"])
            
            logger.info("[PhoBERTEmotion] ✓ ONNX FP32 emotion model loaded successfully on CPU")
            self._instance_initialized = True
            
        except Exception as e:
            logger.error(f"[PhoBERTEmotion] Failed to load ONNX emotion model: {e}")
            raise RuntimeError(f"PhoBERT emotion ONNX model loading failed: {e}")
    
    def is_loaded(self) -> bool:
        """Check if model session is loaded."""
        return self._instance_initialized and self.session is not None
    
    def get_tokenizer(self):
        """Get tokenizer instance."""
        if not self._instance_initialized:
            raise RuntimeError("PhoBERT emotion model not initialized. Call initialize() first.")
        return self.tokenizer
    
    def get_session(self):
        """Get ONNX Runtime session."""
        if not self._instance_initialized:
            raise RuntimeError("PhoBERT emotion model not initialized. Call initialize() first.")
        return self.session
    
    def get_model_name(self) -> str:
        """Get model name."""
        return self.model_name


# Singleton instance
phobert_emotion_model = PhoBERTEmotionModel()


def ensure_phobert_emotion_loaded():
    """Ensure PhoBERT emotion model is loaded."""
    if not phobert_emotion_model._instance_initialized:
        phobert_emotion_model.initialize()
