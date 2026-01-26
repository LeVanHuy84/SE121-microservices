# app/services/ai/image_emotion/image_emotion_analyzer.py

"""
Image Emotion Analysis - Dual-layer emotion detection
- CLIP: Scene-level emotion (context, atmosphere, setting)
- FER: Face-level emotion (authoritative when faces present)

PIPELINE (MANDATORY):
1. ALWAYS run CLIP emotion analysis FIRST (scene emotion)
2. Detect faces
3. If faces detected → ALWAYS run FER (face emotion becomes final)
4. If no faces → CLIP emotion becomes final

ROLE SEPARATION:
- CLIP = scene/contextual emotion
- FER = face-level emotion (authoritative when faces exist)
- NO ensembling, NO averaging, NO overriding
"""

import logging
from typing import List, Dict
import aiohttp
import cv2
import numpy as np
from PIL import Image
from io import BytesIO

from app.services.ai.image_emotion.fer_analyzer import fer_analyzer
from app.services.ai.image_understanding import clip_analyzer

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
    Analyze emotion from a single image URL using CLIP + FER dual pipeline.
    
    PIPELINE:
    1. Download image
    2. CLIP scene emotion (ALWAYS)
    3. Detect faces
    4. FER face emotion (if faces present)
    5. Determine final emotion based on face presence
    
    Args:
        url: Image URL
        
    Returns:
        Analysis result with scene emotion, face emotion, and final emotion
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
        
        # STEP 1: CLIP Scene Emotion (ALWAYS FIRST)
        scene_emotion = clip_analyzer.analyze_emotion(image_data)
        scene_dominant = _get_dominant_emotion(scene_emotion)
        scene_confidence = scene_emotion.get(scene_dominant, 0.0)
        
        # STEP 2: Detect faces
        has_faces = _has_faces_in_image(image_data)
        
        # STEP 3: FER Face Emotion (if faces detected)
        face_emotion = None
        final_emotion = None
        final_source = None
        
        if has_faces:
            # Faces detected - ALWAYS run FER
            fer_result = fer_analyzer.analyze_image(image_data)
            face_emotion = {
                "dominant": fer_result["dominant_emotion"],
                "scores": fer_result["emotions"],
                "confidence": fer_result["confidence"],
                "faceCount": fer_result["face_count"]
            }
            
            # FER becomes final emotion
            final_emotion = fer_result["dominant_emotion"]
            final_source = "FER"
            final_confidence = fer_result["confidence"]
            
        else:
            # No faces - CLIP becomes final emotion
            final_emotion = scene_dominant
            final_source = "CLIP"
            final_confidence = scene_confidence
        
        # Determine scene type
        scene_type = _determine_scene_type(
            final_emotion,
            face_emotion["faceCount"] if face_emotion else 0,
            has_faces
        )
        
        return {
            "url": url,
            "sceneEmotion": {
                "dominant": scene_dominant,
                "scores": scene_emotion,
                "confidence": round(scene_confidence, 4),
                "model": "clip"
            },
            "faceEmotion": face_emotion,
            "finalEmotion": final_emotion,
            "finalSource": final_source,
            "finalConfidence": round(final_confidence, 4),
            "sceneType": scene_type,
            "hasFaces": has_faces
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


def _get_dominant_emotion(emotion_scores: Dict[str, float]) -> str:
    """
    Get dominant emotion from CLIP scores.
    
    Args:
        emotion_scores: Dictionary of emotion -> score
        
    Returns:
        Dominant emotion name
    """
    # Filter out error key if present
    scores = {k: v for k, v in emotion_scores.items() if k != "error"}
    
    if not scores:
        return "neutral"
    
    return max(scores, key=scores.get)


def _has_faces_in_image(image_data: bytes) -> bool:
    """
    Quick face detection check.
    
    Args:
        image_data: Image bytes
        
    Returns:
        True if at least one face detected
    """
    try:
        # Convert to OpenCV format
        image = Image.open(BytesIO(image_data)).convert("RGB")
        cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
        
        # Use Haar Cascade for quick face detection
        face_cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
        
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(30, 30)
        )
        
        return len(faces) > 0
        
    except Exception as e:
        logger.warning(f"Face detection failed: {e}")
        return False


def _determine_scene_type(emotion: str, face_count: int, has_faces: bool) -> str:
    """
    Determine scene type from emotion and face presence.
    
    Args:
        emotion: Final emotion
        face_count: Number of faces detected
        has_faces: Whether faces were detected
        
    Returns:
        Scene type string
    """
    # No faces - environmental/object photo
    if not has_faces or face_count == 0:
        emotion_scene_map = {
            "joy": "cheerful_scene",
            "sadness": "melancholic_scene",
            "anger": "intense_scene",
            "fear": "ominous_scene",
            "surprise": "dramatic_scene",
            "calm": "peaceful_scene",
            "neutral": "neutral_scene"
        }
        return emotion_scene_map.get(emotion, "environmental_scene")
    
    # Multiple faces - social scene
    if face_count > 2:
        if emotion in ["joy", "surprise"]:
            return "social_gathering"
        else:
            return "group_scene"
    
    # Single/couple faces - portrait
    scene_mapping = {
        "sadness": "emotional_portrait",
        "anger": "intense_portrait",
        "fear": "tense_portrait",
        "joy": "happy_portrait",
        "surprise": "dynamic_portrait",
        "neutral": "neutral_portrait",
        "calm": "calm_portrait"
    }
    
    return scene_mapping.get(emotion, "normal_portrait")
