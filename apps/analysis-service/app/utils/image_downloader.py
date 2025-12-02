# app/utils/image_downloader.py
import numpy as np
import requests
import cv2


def download_image_to_cv2(url: str, timeout: int = 10) -> np.ndarray:
    """
    Download an image from URL using requests and convert to OpenCV BGR numpy array.
    """
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
        arr = np.frombuffer(resp.content, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Invalid image data")
        return img
    except Exception as e:
        logger.warning("Failed to download image %s: %s", url, e)
        return None