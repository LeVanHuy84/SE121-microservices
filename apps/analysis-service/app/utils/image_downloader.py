# app/utils/image_downloader.py
import aiohttp
import asyncio
import logging
import numpy as np
import cv2

logger = logging.getLogger(__name__)

async def download_image_to_cv2(url: str, retry: int = 3, base_delay: float = 0.5):
    """
    Async image downloader with retry + exponential backoff.
    Returns OpenCV BGR image or None.
    """
    for attempt in range(1, retry + 1):
        try:
            timeout = aiohttp.ClientTimeout(total=12)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        raise Exception(f"HTTP {resp.status}")

                    content = await resp.read()
                    arr = np.asarray(bytearray(content), dtype=np.uint8)
                    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

                    if img is None:
                        raise ValueError("Invalid or corrupted image data")

                    return img

        except Exception as e:
            logger.warning(
                "[DownloadError] Attempt %d/%d for %s failed: %s",
                attempt, retry, url, e
            )
            await asyncio.sleep(base_delay * attempt)  # 0.5 → 1.0 → 1.5 seconds

    logger.error("Image download failed permanently after %d attempts: %s", retry, url)
    return None
