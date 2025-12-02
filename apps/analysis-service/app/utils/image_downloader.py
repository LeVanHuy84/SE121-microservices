# app/utils/image_downloader.py
import aiohttp
import cv2
import numpy as np
from typing import Optional

async def download_image_to_cv2(url: str, timeout: int = 15) -> Optional[np.ndarray]:
    """
    Download image bytes from url and return OpenCV BGR numpy array.
    Returns None if failed.
    """
    try:
        timeout_cfg = aiohttp.ClientTimeout(total=timeout)
        async with aiohttp.ClientSession(timeout=timeout_cfg) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return None
                data = await resp.read()

        nparr = np.frombuffer(data, dtype=np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)  # BGR
        return img
    except Exception:
        return None
