"""
Orchestration Service: Music Flow
- Downloads remote MP3
- Delegates analysis to domain service
- Returns structured response payload
"""

import logging
import os
import time

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
        t_total_start = time.perf_counter()
        try:
            logger.info(f"[MusicFlowService] Downloading audio from URL: {url[:80]}...")
            t_dl_start = time.perf_counter()
            file_path = self._downloader.download(url)
            t_dl_ms = (time.perf_counter() - t_dl_start) * 1000
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            logger.info(f"[MusicFlowService] ✓ Downloaded {file_size_mb:.2f} MB in {t_dl_ms:.2f} ms")

            t_infer_start = time.perf_counter()
            result = self._analyze_service.analyze_music(file_path)
            t_infer_ms = (time.perf_counter() - t_infer_start) * 1000
            t_total_ms = (time.perf_counter() - t_total_start) * 1000

            logger.info(
                f"[MusicFlowService] ✓ Analysis complete: valence={result['valence']}, arousal={result['arousal']} "
                f"(Download: {t_dl_ms:.0f}ms | AI Inference: {t_infer_ms:.0f}ms | Total: {t_total_ms:.0f}ms)"
            )
            return {
                "valence": float(result["valence"]),
                "arousal": float(result["arousal"]),
            }

        except Exception as e:
            t_total_ms = (time.perf_counter() - t_total_start) * 1000
            logger.error(f"[MusicFlowService] Analysis failed after {t_total_ms:.0f}ms: {e}")
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
