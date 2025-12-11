# app/utils/image_downloader.py

import aiohttp
import asyncio
import logging
import numpy as np
import cv2
from aiohttp import ClientError
from app.utils.download_result import DownloadResult, DownloadError


logger = logging.getLogger(__name__)

RETRYABLE_STATUS = {408, 429, 500, 502, 503, 504}

def is_retryable_exception(e: Exception):
    if isinstance(e, ClientError):
        return True
    if isinstance(e, asyncio.TimeoutError):
        return True

    msg = str(e).lower()
    return any(k in msg for k in [
        "timeout", "temporarily", "reset", "unreachable", "connection aborted"
    ])

async def download_image_to_cv2(
    url: str,
    session: aiohttp.ClientSession,
    retry: int = 3,
    base_delay: float = 0.5,
) -> DownloadResult:

    for attempt in range(1, retry + 1):
        try:
            async with session.get(url) as resp:

                # Non-retryable HTTP
                if resp.status >= 400 and resp.status not in RETRYABLE_STATUS:
                    return DownloadResult(
                        image=None,
                        error=DownloadError(
                            message=f"Non retryable HTTP {resp.status}",
                            retryable=False
                        )
                    )

                # Retryable HTTP
                if resp.status in RETRYABLE_STATUS:
                    raise Exception(f"HTTP {resp.status}")

                content = await resp.read()
                arr = np.frombuffer(content, np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)

                if img is None:
                    return DownloadResult(
                        image=None,
                        error=DownloadError(
                            message="cv2 decode failed",
                            retryable=False
                        )
                    )

                return DownloadResult(image=img, error=None)

        except Exception as e:
            retryable = is_retryable_exception(e)

            if attempt == retry or not retryable:
                return DownloadResult(
                    image=None,
                    error=DownloadError(
                        message=str(e),
                        retryable=retryable
                    )
                )

            delay = base_delay * (2 ** (attempt - 1))
            await asyncio.sleep(delay)

    return DownloadResult(
        image=None,
        error=DownloadError(
            message="unexpected exit",
            retryable=False
        )
    )

