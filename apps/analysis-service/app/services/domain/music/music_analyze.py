"""
Domain Service: Music Analyze
- Orchestrates AI analyzer usage
- Performs basic validation only
- No ML feature engineering logic
"""

import logging
import os

from app.services.ai.music.music_emotion_analyzer import MusicEmotionAnalyzer

logger = logging.getLogger(__name__)


class MusicAnalyzeService:
    """Domain wrapper for music emotion analysis."""

    def __init__(self, analyzer: MusicEmotionAnalyzer | None = None):
        self._analyzer = analyzer or MusicEmotionAnalyzer()

    def analyze_music(self, file_path: str) -> dict:
        """Validate input and delegate to AI analyzer."""
        if not file_path or not isinstance(file_path, str):
            raise ValueError("file_path must be a non-empty string")

        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Audio file not found: {file_path}")

        logger.info("[MusicAnalyzeService] Analyzing music file")
        result = self._analyzer.analyze(file_path)

        return {
            "valence": float(result["valence"]),
            "arousal": float(result["arousal"]),
        }


music_analyze_service = MusicAnalyzeService()
