"""
Music Model Loader - Singleton for MERT ONNX Music Emotion Model
- Loads MERT ONNX session
- Supports local weights and Hugging Face Hub download fallback
"""

import logging
from pathlib import Path
import numpy as np
import onnxruntime as ort

from app.core.settings import settings
from app.modules.analysis.services.ml_models.model_resolver import resolve_onnx_model

logger = logging.getLogger(__name__)


class MusicModelLoader:
    """
    Music model loader for MERT ONNX model (singleton).

    Responsibilities:
    - Load MERT ONNX via ONNX Runtime
    - Expose loaded session for inference
    """

    _instance_initialized = False

    def __init__(self):
        self.session = None
        self.model_name = settings.MERT_MUSIC_MODEL_PATH
        self.precision = getattr(settings, "MERT_MUSIC_PRECISION", "int8").lower()
        self.onnx_model_path = None
        self.input_name = None

    def initialize(self):
        """Load MERT ONNX model."""
        if self._instance_initialized:
            return

        try:
            candidate_dirs = [
                Path("evaluation/music/weights").resolve(),
                Path("../evaluation/music/weights").resolve(),
                Path("../../evaluation/music/weights").resolve(),
            ]
            current_dir = Path(__file__).resolve().parent
            for _ in range(10):
                mert_dir = current_dir / "evaluation" / "music" / "weights"
                if mert_dir.exists():
                    candidate_dirs.insert(0, mert_dir)
                    break
                if current_dir.parent == current_dir:
                    break
                current_dir = current_dir.parent

            self.onnx_model_path, _ = resolve_onnx_model(
                model_path_or_repo=self.model_name,
                explicit_onnx_path=settings.MERT_MUSIC_ONNX_PATH,
                precision=self.precision,
                model_type_hint="mert_emotion",
                candidate_local_dirs=candidate_dirs,
            )

            logger.info(
                f"[MusicModelLoader] Loading MERT ONNX ({self.precision}) model from: {self.onnx_model_path}"
            )

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = (
                4  # 4 threads optimal for CPU vectorization without contention
            )
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_cpu_mem_arena = False
            opts.add_session_config_entry("session.intra_op.allow_spinning", "0")

            self.session = ort.InferenceSession(
                self.onnx_model_path, opts, providers=["CPUExecutionProvider"]
            )
            self.input_name = self.session.get_inputs()[0].name

            # Pre-warmup session to avoid cold-start latency on first request (2s audio)
            dummy_waveform = np.random.randn(1, 24000 * 2).astype(np.float32)
            self.session.run(None, {self.input_name: dummy_waveform})

            self._instance_initialized = True
            logger.info(
                f"[MusicModelLoader] ✓ MERT Music Emotion ONNX ({self.precision}) model loaded & pre-warmed successfully on CPU"
            )

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
    if not music_model_loader.is_loaded():
        music_model_loader.initialize()
