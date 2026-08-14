"""
Orchestration Service: Music Flow
- Downloads remote MP3
- Delegates analysis to domain service
- Returns structured response payload
"""

import logging
import os

from app.modules.analysis.services.domain.music.music_analyze import MusicAnalyzeService
from app.modules.analysis.utils.download_mp3 import AudioDownloader

logger = logging.getLogger(__name__)


class MusicFlowService:
    """Application flow service for music emotion analysis from URL."""

    def __init__(
        self,
        downloader: AudioDownloader | None = None,
        analyze_service: MusicAnalyzeService | None = None,
    ):
        self._downloader = downloader or AudioDownloader()
        self._analyze_service = analyze_service or MusicAnalyzeService()

    def analyze_from_url(self, url: str) -> dict:
        """Download audio from URL, analyze, and return normalized response."""
        if not url or not isinstance(url, str):
            raise ValueError("url must be a non-empty string")

        file_path = None
        try:
            logger.info("[MusicFlowService] Downloading audio from URL")
            file_path = self._downloader.download(url)

            result = self._analyze_service.analyze_music(file_path)
            return {
                "valence": float(result["valence"]),
                "arousal": float(result["arousal"]),
            }

        except Exception as e:
            logger.error(f"[MusicFlowService] Analysis failed: {e}")
            raise

        finally:
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as cleanup_error:
                    logger.warning(
                        f"[MusicFlowService] Failed to remove temp file: {cleanup_error}"
                    )


music_flow_service = MusicFlowService()
