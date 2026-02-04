# app/services/ai/image_emotion/image_emotion_analyzer.py

"""
Image Emotion Analysis - Dual-layer emotion detection

ARCHITECTURE:
- CLIP: Scene-level emotion (context, atmosphere, setting)
- FER: Face-level emotion (authoritative when faces present)

PIPELINE (STRICT):
1. ALWAYS run CLIP emotion analysis FIRST (scene emotion)
2. ALWAYS run FER once (FER handles face detection internally)
3. If face_count > 0 → FER is authoritative
4. If face_count == 0 → CLIP is final

PRINCIPLES:
- NO ensembling
- NO averaging
- NO voting
- NO confidence blending
- Single source of truth per layer
"""

import logging
from typing import List, Dict
from app.core.dto.image_input import ImageInput
from app.services.domain.emotion.emotion_normalizer import normalize_image_label
from app.services.ai.image_emotion.fer_analyzer import fer_analyzer
from app.services.ai.image_understanding import clip_analyzer

logger = logging.getLogger(__name__)


# =============================================================================
# CORE API
# =============================================================================

async def analyze_single_image(image: ImageInput) -> dict:
    """
    Analyze emotion from a single image URL using CLIP + FER dual pipeline.

    Returns:
        {
            url,
            sceneEmotion,
            faceEmotion,
            finalEmotion,
            finalSource,
            finalConfidence,
            sceneType
        }
    """
    try:
        # ---------------------------------------------------------------------
        # Download
        # ---------------------------------------------------------------------
        image_data = image.bytes

        if not image_data:
            return {
                "url": image.url,
                "error": "download_failed",
                "retryable": True
            }

        # ---------------------------------------------------------------------
        # STEP 1: CLIP Scene Emotion (ALWAYS FIRST)
        # ---------------------------------------------------------------------
        scene_emotion = clip_analyzer.analyze_emotion(image_data)
        scene_dominant = _get_dominant_emotion(scene_emotion)
        scene_confidence = scene_emotion.get(scene_dominant, 0.0)

        # ---------------------------------------------------------------------
        # STEP 2: FER (ALWAYS RUN ONCE)
        # FER internally handles face detection
        # ---------------------------------------------------------------------
        fer_result = fer_analyzer.analyze_image(image_data)
        face_count = fer_result["face_count"]

        # ---------------------------------------------------------------------
        # STEP 3: Decision Policy (AUTHORITATIVE SOURCE)
        # ---------------------------------------------------------------------
        if face_count > 0:
            fer_scores = _normalize_fer_emotions(fer_result["emotions"])

            dominant = _get_dominant_emotion(fer_scores)
            confidence = fer_scores.get(dominant, 0.0)

            final_emotion = dominant
            final_source = "FER"
            final_confidence = confidence

            face_emotion = {
                "dominant": dominant,
                "scores": fer_scores,
                "confidence": round(confidence, 4),
                "faceCount": face_count
            }

        else:
            # No faces → CLIP authoritative
            final_emotion = scene_dominant
            final_source = "CLIP"
            final_confidence = scene_confidence
            face_emotion = None

        # ---------------------------------------------------------------------
        # STEP 4: Scene Typing (semantic layer)
        # ---------------------------------------------------------------------
        scene_type = _determine_scene_type(
            final_emotion=final_emotion,
            face_count=face_count
        )

        # ---------------------------------------------------------------------
        # Response
        # ---------------------------------------------------------------------
        return {
            "url": image.url,
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
            "sceneType": scene_type
        }

    except Exception as e:
        logger.exception(f"Error analyzing image {image.url}: {e}")
        return {
            "url": image.url,
            "error": str(e),
            "retryable": True
        }


async def analyze_multiple_images(images: List[ImageInput]) -> List[dict]:
    """
    Analyze emotion from multiple image URLs concurrently.
    """
    if not images:
        return []

    import asyncio
    tasks = [analyze_single_image(image) for image in images]
    results = await asyncio.gather(*tasks)

    return list(results)


# =============================================================================
# HELPERS
# =============================================================================

def _get_dominant_emotion(
    emotion_scores: Dict[str, float],
    min_confidence: float = 0.35
) -> str:
    """
    Get dominant emotion with confidence threshold protection.
    Prevents low-signal random emotion selection.

    Args:
        emotion_scores: emotion -> score
        min_confidence: minimum confidence to accept emotion

    Returns:
        emotion label
    """
    if not emotion_scores:
        return "neutral"

    emotion, score = max(emotion_scores.items(), key=lambda x: x[1])

    if score < min_confidence:
        return "neutral"

    return emotion


def _determine_scene_type(
    final_emotion: str,
    face_count: int
) -> str:
    """
    Determine semantic scene type from emotion + face presence.
    """

    # ---------------------------------------------------------------------
    # No faces → environmental / object / landscape
    # ---------------------------------------------------------------------
    if face_count == 0:
        emotion_scene_map = {
            "joy": "cheerful_scene",
            "sadness": "melancholic_scene",
            "anger": "intense_scene",
            "fear": "ominous_scene",
            "surprise": "dramatic_scene",
            "neutral": "neutral_scene",
            "disgust": "disturbing_scene",
        }
        return emotion_scene_map.get(final_emotion, "environmental_scene")

    # ---------------------------------------------------------------------
    # Multi-face → social context
    # ---------------------------------------------------------------------
    if face_count > 2:
        if final_emotion in ["joy", "surprise"]:
            return "social_gathering"
        return "group_scene"

    # ---------------------------------------------------------------------
    # Single / couple face → portrait
    # ---------------------------------------------------------------------
    portrait_map = {
        "sadness": "emotional_portrait",
        "anger": "intense_portrait",
        "fear": "tense_portrait",
        "joy": "happy_portrait",
        "surprise": "dynamic_portrait",
        "neutral": "neutral_portrait",
        "disgust": "disturbing_portrait",
    }

    return portrait_map.get(final_emotion, "normal_portrait")


def _normalize_fer_emotions(raw_emotions: Dict[str, float]) -> Dict[str, float]:
    """
    Normalize FER raw emotion scores into domain emotion scores.
    """
    normalized = {}

    for raw_label, score in raw_emotions.items():
        enum = normalize_image_label(raw_label)
        key = enum.value
        normalized[key] = normalized.get(key, 0.0) + score

    return {k: round(v, 4) for k, v in normalized.items()}

