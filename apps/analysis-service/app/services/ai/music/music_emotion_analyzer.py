"""
Music Emotion Analyzer
- Feature extraction (librosa)
- Inference using loaded valence/arousal models
"""

import logging

import librosa
import numpy as np

from .music_loader import ensure_music_model_loaded, music_model_loader

logger = logging.getLogger(__name__)


class MusicEmotionAnalyzer:
    """AI inference service for music valence/arousal prediction."""

    @staticmethod
    def _extract_features(file_path: str) -> list:
        """
        Extract 19 features in exact training order:
        1) tempo
        2) rms
        3) spectral_centroid
        4) zero_crossing_rate
        5) spectral_bandwidth
        6) spectral_rolloff
        7) mfcc_1..13
        """
        try:
            y, sr = librosa.load(file_path, sr=22050, mono=True)
        except Exception as e:
            logger.error(f"[MusicEmotionAnalyzer] librosa load failed: {e}")
            raise ValueError(f"Invalid audio file: {e}") from e

        if y is None or len(y) == 0:
            raise ValueError("Empty audio")

        try:
            features = []

            tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(np.squeeze(tempo))
            features.append(tempo)

            rms = librosa.feature.rms(y=y)
            features.append(float(np.mean(rms)))

            spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr)
            features.append(float(np.mean(spectral_centroid)))

            zcr = librosa.feature.zero_crossing_rate(y)
            features.append(float(np.mean(zcr)))

            spectral_bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr)
            features.append(float(np.mean(spectral_bandwidth)))

            spectral_rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr)
            features.append(float(np.mean(spectral_rolloff)))

            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
            features.extend(np.mean(mfcc, axis=1).astype(float).tolist())

            if len(features) != 19:
                raise ValueError(f"Expected 19 features, got {len(features)}")

            feature_array = np.array(features, dtype=np.float64)
            if np.any(np.isnan(feature_array)) or np.any(np.isinf(feature_array)):
                raise ValueError("Feature extraction produced NaN/Inf")

            return {
                "tempo": features[0],
                "rms": features[1],
                "centroid": features[2],
                "zcr": features[3],
                "raw": features
            }

        except Exception as e:
            logger.error(f"[MusicEmotionAnalyzer] feature extraction failed: {e}")
            raise

    def analyze(self, file_path: str) -> dict:
        """Analyze a music file and return valence/arousal prediction."""
        ensure_music_model_loaded()

        if not music_model_loader.is_loaded():
            raise RuntimeError("Music models are not loaded")

        model_valence, model_arousal = music_model_loader.get_models()
        feature_data = self._extract_features(file_path)

        try:
            valence_pred = float(model_valence.predict([feature_data["raw"]])[0])
            arousal_pred = float(model_arousal.predict([feature_data["raw"]])[0])
        except Exception as e:
            logger.error(f"[MusicEmotionAnalyzer] prediction failed: {e}")
            raise RuntimeError(f"Music prediction failed: {e}") from e

        return {
            "valence": valence_pred,
            "arousal": arousal_pred,
            "tempo": feature_data["tempo"],
            "rms": feature_data["rms"],
            "spectral_centroid": feature_data["centroid"],
            "zcr": feature_data["zcr"],
        }


music_emotion_analyzer = MusicEmotionAnalyzer()