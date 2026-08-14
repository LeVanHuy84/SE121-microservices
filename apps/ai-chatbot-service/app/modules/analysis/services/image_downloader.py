"""
Image Downloader Service
- Download images ONCE per request
- Reuse HTTP session
- Return ImageInput DTO
- No business logic
- No AI knowledge
"""

import logging
import aiohttp
import asyncio
from typing import List, Optional

from app.modules.analysis.schemas import ImageInput

logger = logging.getLogger(__name__)


class ImageDownloader:
    """
    Application-level IO service.
    Responsible ONLY for downloading images.
    """

    _http_session: Optional[aiohttp.ClientSession] = None

    # ==================================================
    # SESSION MANAGEMENT
    # ==================================================

    async def _get_http_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession()
        return self._http_session

    async def close(self):
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()

    # ==================================================
    # CORE API
    # ==================================================

    async def download(
        self,
        urls: List[str],
        timeout: int = 10
    ) -> List[ImageInput]:
        """
        Download multiple images concurrently.

        Args:
            urls: list of image URLs
            timeout: request timeout (seconds)

        Returns:
            List[ImageInput]
        """

        if not urls:
            return []

        session = await self._get_http_session()

        async def fetch(url: str) -> Optional[ImageInput]:
            try:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=timeout)
                ) as res:
                    if res.status == 200:
                        data = await res.read()
                        return ImageInput(
                            url=url,
                            bytes=data
                        )

                    logger.warning(
                        "[ImageDownloader] status=%s url=%s",
                        res.status,
                        url
                    )

            except asyncio.TimeoutError:
                logger.warning("[ImageDownloader] timeout url=%s", url)
            except Exception as e:
                logger.exception(
                    "[ImageDownloader] failed url=%s error=%s",
                    url,
                    e
                )

            return None

        results = await asyncio.gather(
            *[fetch(url) for url in urls],
            return_exceptions=False
        )

        # filter None
        images = [img for img in results if img]

        logger.debug(
            "[ImageDownloader] downloaded %s/%s images",
            len(images),
            len(urls)
        )

        return images


# ==================================================
# Singleton (Application scope)
# ==================================================

image_downloader = ImageDownloader()
