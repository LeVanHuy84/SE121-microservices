# app/services/ai/image_emotion/image_emotion_analyzer.py

"""
Image Emotion Analysis - Orchestrates FER-based emotion detection
- Downloads images from URLs
- Uses FER for facial emotion recognition
- Handles errors and retries
"""

import logging
from typing import List
import aiohttp

from app.services.ai.image_emotion.fer_analyzer import fer_analyzer

logger = logging.getLogger(__name__)


async def download_image(url: str) -> bytes:
    """
    Download image from URL.
    
    Args:
        url: Image URL
        
    Returns:
        Image bytes or None if failed
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                if response.status == 200:
                    return await response.read()
                else:
                    logger.error(f"Failed to download image from {url}: {response.status}")
                    return None
    except Exception as e:
        logger.error(f"Error downloading image from {url}: {e}")
        return None


async def analyze_single_image_url(url: str) -> dict:
    """
    Analyze emotion from a single image URL using FER.
    
    Args:
        url: Image URL
        
    Returns:
        Analysis result with emotions
    """
    try:
        # Download image
        image_data = await download_image(url)
        
        if not image_data:
            return {
                "url": url,
                "error": "download_failed",
                "retryable": True
            }
        
        # Analyze with FER
        result = fer_analyzer.analyze_image(image_data)
        
        # Determine scene type from dominant emotion and face count
        scene_type = _determine_scene_type(
            result["dominant_emotion"],
            result.get("face_count", 0)
        )
        
        return {
            "url": url,
            "dominantEmotion": result["dominant_emotion"],
            "emotionScores": result["emotions"],
            "confidence": result["confidence"],
            "faceCount": result.get("face_count", 0),
            "sceneType": scene_type,
            "model": "fer"
        }
        
    except Exception as e:
        logger.exception(f"Error analyzing image {url}: {e}")
        return {
            "url": url,
            "error": str(e),
            "retryable": True
        }


async def analyze_multiple_image_urls(urls: List[str]) -> List[dict]:
    """
    Analyze emotion from multiple image URLs.
    
    Args:
        urls: List of image URLs
        
    Returns:
        List of analysis results
    """
    if not urls:
        return []
    
    import asyncio
    tasks = [analyze_single_image_url(url) for url in urls]
    results = await asyncio.gather(*tasks)
    
    return list(results)


def _determine_scene_type(emotion: str, face_count: int) -> str:
    """
    Determine scene type from dominant emotion and face count.
    
    Args:
        emotion: Dominant emotion
        face_count: Number of faces detected
        
    Returns:
        Scene type string
    """
    # No faces - environmental/object photo
    if face_count == 0:
        return "no_faces_scene"
    
    # Multiple faces - social scene
    if face_count > 2:
        if emotion in ["joy", "surprise"]:
            return "social_gathering"
        else:
            return "group_scene"
    
    # Single/couple faces - portrait/personal
    scene_mapping = {
        "sadness": "emotional_portrait",
        "anger": "intense_portrait",
        "fear": "tense_portrait",
        "joy": "happy_portrait",
        "surprise": "dynamic_portrait",
        "neutral": "neutral_portrait",
        "disgust": "negative_portrait"
    }
    
    return scene_mapping.get(emotion, "normal_portrait")
