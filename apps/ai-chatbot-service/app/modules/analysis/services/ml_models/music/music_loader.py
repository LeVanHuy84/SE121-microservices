"""
Music Model Loader - Singleton for MERT ONNX INT8 Music Emotion Model
- Loads MERT ONNX session
- Supports local weights and Hugging Face Hub download fallback
"""

import os
import logging
from pathlib import Path
import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download

from app.core.settings import settings

logger = logging.getLogger(__name__)


class MusicModelLoader:
    """
    Music model loader for MERT ONNX INT8 model (singleton).
    
    Responsibilities:
    - Load mert_emotion_int8.onnx via ONNX Runtime
    - Expose loaded session for inference
    """

    _instance_initialized = False

    def __init__(self):
        self.session = None
        self.model_name = settings.MERT_MUSIC_MODEL_PATH
        self.onnx_model_path = None
        self.input_name = None

    def _resolve_model_path(self) -> str:
        """Resolve local ONNX weight file or download from Hugging Face Hub."""
        if settings.MERT_MUSIC_ONNX_PATH and os.path.exists(settings.MERT_MUSIC_ONNX_PATH):
            return settings.MERT_MUSIC_ONNX_PATH

        # Search upwards for monorepo root containing evaluation directory
        candidate_paths = [
            Path("evaluation/music/weights/mert_emotion_int8.onnx").resolve(),
            Path("../evaluation/music/weights/mert_emotion_int8.onnx").resolve(),
            Path("../../evaluation/music/weights/mert_emotion_int8.onnx").resolve(),
        ]
        
        # Traverse up from current file to find repository root
        current_dir = Path(__file__).resolve().parent
        for _ in range(10):
            mert_file = current_dir / "evaluation" / "music" / "weights" / "mert_emotion_int8.onnx"
            if mert_file.exists():
                candidate_paths.insert(0, mert_file)
                break
            if current_dir.parent == current_dir:
                break
            current_dir = current_dir.parent

        for p in candidate_paths:
            if p.exists():
                logger.info(f"[MusicModelLoader] Found local MERT ONNX weights at: {p}")
                return str(p)

        logger.info(f"[MusicModelLoader] Downloading MERT ONNX INT8 model from Hugging Face Hub ({self.model_name})...")
        downloaded = hf_hub_download(
            repo_id=self.model_name,
            filename="mert_emotion_int8.onnx"
        )
        return downloaded

    def initialize(self):
        """Load MERT ONNX INT8 model."""
        if self._instance_initialized:
            return

        try:
            self.onnx_model_path = self._resolve_model_path()
            logger.info(f"[MusicModelLoader] Loading MERT ONNX INT8 model from: {self.onnx_model_path}")

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 4  # 4 threads optimal for CPU vectorization without contention
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

            self.session = ort.InferenceSession(self.onnx_model_path, opts, providers=["CPUExecutionProvider"])
            self.input_name = self.session.get_inputs()[0].name

            # Pre-warmup session to avoid cold-start latency on first request
            dummy_waveform = np.random.randn(1, 24000 * 15).astype(np.float32)
            self.session.run(None, {self.input_name: dummy_waveform})

            self._instance_initialized = True
            logger.info("[MusicModelLoader] ✓ MERT Music Emotion ONNX model loaded & pre-warmed successfully on CPU")

        except Exception as e:
            logger.error(f"[MusicModelLoader] ✗ Failed to load MERT ONNX model: {e}")
            raise RuntimeError(f"MERT Music model loading failed: {e}") from e

    def is_loaded(self) -> bool:
        """Check if MERT music model is loaded and ready."""
        return self._instance_initialized and self.session is not None

    def get_session(self):
        """Return loaded ONNX Runtime session."""
        if not self.is_loaded():
            raise RuntimeError("Music models not loaded. Call initialize() first.")
        return self.session, self.input_name


music_model_loader = MusicModelLoader()


def ensure_music_model_loaded():
    """Ensure music models are loaded (idempotent)."""
    if not music_model_loader._instance_initialized:
        music_model_loader.initialize()
