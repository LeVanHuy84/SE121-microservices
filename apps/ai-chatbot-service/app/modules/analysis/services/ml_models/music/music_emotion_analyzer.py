"""
Music Emotion Analyzer using MERT Transformer ONNX INT8
- Audio loading via soundfile
- Fast 24kHz resampling via scipy.signal.resample
- 15-second center/chorus windowing (Peak-End Rule & Thin-Slicing SOTA)
- Inference using loaded MERT ONNX session
"""

import os
import logging
import numpy as np
import soundfile as sf
import scipy.signal

from .music_loader import ensure_music_model_loaded, music_model_loader

logger = logging.getLogger(__name__)


class MusicEmotionAnalyzer:
    """AI inference service for music valence/arousal prediction using MERT ONNX."""

    TARGET_SAMPLE_RATE = 24000
    TARGET_DURATION_SECONDS = 15
    TARGET_SAMPLES = TARGET_SAMPLE_RATE * TARGET_DURATION_SECONDS  # 360,000 samples

    @staticmethod
    def _preprocess_audio(file_path: str) -> np.ndarray:
        """
        Preprocess audio file to MERT input specifications:
        1. Read audio via soundfile
        2. Convert multi-channel to mono
        3. Center-clip 15 seconds at original sample rate FIRST (100x faster than resampling entire song)
        4. Resample the 15s segment to 24,000 Hz using scipy.signal
        5. Guarantee exact shape: (1, 360000)
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        try:
            data, sr = sf.read(file_path, dtype="float32")
        except Exception as e:
            logger.error(f"[MusicEmotionAnalyzer] soundfile read failed: {e}")
            raise ValueError(f"Invalid audio file: {e}") from e

        if data is None or len(data) == 0:
            raise ValueError("Empty audio")

        # 1. Convert to Mono
        if data.ndim > 1:
            data = np.mean(data, axis=1)

        # 2. Center-clip 15 seconds at original SR before resampling
        target_raw_samples = int(sr * MusicEmotionAnalyzer.TARGET_DURATION_SECONDS)
        total_raw_samples = len(data)

        if total_raw_samples > target_raw_samples:
            start = (total_raw_samples - target_raw_samples) // 2
            data = data[start:start + target_raw_samples]
        elif total_raw_samples < target_raw_samples:
            padding = target_raw_samples - total_raw_samples
            data = np.pad(data, (0, padding), mode="constant")

        # 3. Resample the 15s segment to 24kHz
        if sr != MusicEmotionAnalyzer.TARGET_SAMPLE_RATE:
            data = scipy.signal.resample(data, MusicEmotionAnalyzer.TARGET_SAMPLES).astype(np.float32)

        # 4. Guarantee exact TARGET_SAMPLES (360,000 samples)
        target = MusicEmotionAnalyzer.TARGET_SAMPLES
        total_resampled = len(data)

        if total_resampled > target:
            data = data[:target]
        elif total_resampled < target:
            padding = target - total_resampled
            data = np.pad(data, (0, padding), mode="constant")

        # Ensure float32 shape: (1, 360000)
        return data[np.newaxis, :].astype(np.float32)

    def analyze(self, file_path: str) -> dict:
        """Analyze a music file and return valence/arousal prediction."""
        ensure_music_model_loaded()

        if not music_model_loader.is_loaded():
            raise RuntimeError("MERT Music model is not loaded")

        session, input_name = music_model_loader.get_session()
        waveform = self._preprocess_audio(file_path)

        try:
            outputs = session.run(None, {input_name: waveform})
            val_arous = outputs[0][0]  # Shape: (2,)

            valence = float(np.clip(val_arous[0], 0.0, 1.0))
            arousal = float(np.clip(val_arous[1], 0.0, 1.0))

        except Exception as e:
            logger.error(f"[MusicEmotionAnalyzer] MERT prediction failed: {e}")
            raise RuntimeError(f"Music prediction failed: {e}") from e

        return {
            "valence": round(valence, 4),
            "arousal": round(arousal, 4),
        }


music_emotion_analyzer = MusicEmotionAnalyzer()