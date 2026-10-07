import logging
from pathlib import Path
import onnxruntime as ort
from transformers import AutoTokenizer

from app.core.settings import settings
from app.modules.analysis.services.ml_models.model_resolver import resolve_onnx_model

logger = logging.getLogger(__name__)


class PhoBERTEmotionModel:
    """
    PhoBERT model for Vietnamese text emotion classification using ONNX Runtime.

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
        self.precision = getattr(settings, "PHOBERT_EMOTION_PRECISION", "fp32").lower()
        self.onnx_model_path = None
        self.tokenizer_source = None

    def initialize(self):
        """Initialize PhoBERT emotion ONNX model."""
        if self._instance_initialized:
            return

        try:
            candidate_dirs = [
                Path(__file__).resolve().parents[7] / "evaluation" / "weights",
                Path("evaluation/weights").resolve(),
                Path("../evaluation/weights").resolve(),
                Path("../../evaluation/weights").resolve(),
            ]

            self.onnx_model_path, self.tokenizer_source = resolve_onnx_model(
                model_path_or_repo=self.model_name,
                explicit_onnx_path=settings.PHOBERT_EMOTION_ONNX_PATH,
                precision=self.precision,
                model_type_hint="phobert_emotion",
                candidate_local_dirs=candidate_dirs,
            )

            # Auto-deduce precision from model path if not explicitly overridden
            detected_precision = self.precision
            if "int8" in str(self.onnx_model_path).lower():
                detected_precision = "int8"
            elif "fp32" in str(self.onnx_model_path).lower():
                detected_precision = "fp32"
            self.precision = detected_precision

            logger.info(
                "[PhoBERTEmotion] Loading ONNX (%s) model from: %s (Tokenizer: %s)",
                self.precision,
                self.onnx_model_path,
                self.tokenizer_source,
            )

            self.tokenizer = AutoTokenizer.from_pretrained(self.tokenizer_source)

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_cpu_mem_arena = False
            opts.add_session_config_entry("session.intra_op.allow_spinning", "0")

            self.session = ort.InferenceSession(
                self.onnx_model_path, opts, providers=["CPUExecutionProvider"]
            )

            logger.info(
                f"[PhoBERTEmotion] ✓ ONNX ({self.precision}) emotion model loaded successfully on CPU"
            )
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
            raise RuntimeError(
                "PhoBERT emotion model not initialized. Call initialize() first."
            )
        return self.tokenizer

    def get_session(self):
        """Get ONNX Runtime session."""
        if not self._instance_initialized:
            raise RuntimeError(
                "PhoBERT emotion model not initialized. Call initialize() first."
            )
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
