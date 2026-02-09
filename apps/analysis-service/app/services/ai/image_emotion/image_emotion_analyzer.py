# app/services/ai/image_emotion/image_emotion_analyzer.py

"""
Image Emotion Analysis - Dual-layer emotion detection (Refactored)

ARCHITECTURE:
- CLIP: Scene-level emotion
- FER: Face-level emotion (authoritative when faces present)

PIPELINE:
1. CLIP always runs first
2. FER always runs once
3. face_count > 0 → FER authoritative
4. face_count == 0 → CLIP authoritative

OUTPUT:
- Domain-ready schema
- Semantic context included
- Analysis metadata included
"""

import logging
from typing import List, Dict
from app.core.dto.image_input import ImageInput
from app.services.domain.emotion.emotion_normalizer import normalize_image_label
from app.services.ai.image_emotion.fer_analyzer import fer_analyzer
from app.services.ai.image_understanding import clip_analyzer

logger = logging.getLogger(__name__)

PIPELINE_VERSION = "1.0"
SEMANTIC_VERSION = "1.0"


# =============================================================================
# CORE API
# =============================================================================

async def analyze_single_image(image: ImageInput) -> dict:
    try:
        image_data = image.bytes

        if not image_data:
            return {
                "url": image.url,
                "error": "download_failed",
                "retryable": True
            }

        # ------------------------------------------------------------------
        # STEP 1 — CLIP Scene Emotion
        # ------------------------------------------------------------------
        scene_emotion = clip_analyzer.analyze_emotion(image_data)
        scene_dominant = _get_dominant_emotion(scene_emotion)
        scene_confidence = scene_emotion.get(scene_dominant, 0.0)

        # ------------------------------------------------------------------
        # STEP 2 — FER Face Emotion
        # ------------------------------------------------------------------
        fer_result = fer_analyzer.analyze_image(image_data)
        face_count = fer_result["face_count"]

        # ------------------------------------------------------------------
        # STEP 3 — Decision Policy
        # ------------------------------------------------------------------
        if face_count > 0:
            fer_scores = _normalize_fer_emotions(fer_result["emotions"])

            dominant = _get_dominant_emotion(fer_scores)
            final_scores = fer_scores
            confidence = fer_scores.get(dominant, 0.0)

            final_emotion = dominant
            final_source = "FER"
            final_confidence = confidence

            face_dominant = dominant
            face_confidence = confidence

        else:
            final_scores = scene_emotion
            final_emotion = scene_dominant
            final_source = "CLIP"
            final_confidence = scene_confidence

            face_dominant = None
            face_confidence = None

        # ------------------------------------------------------------------
        # STEP 4 — Semantic Layer
        # ------------------------------------------------------------------
        scene_type = _determine_scene_type(
            final_emotion=final_emotion,
            face_count=face_count
        )

        # ------------------------------------------------------------------
        # DOMAIN OUTPUT
        # ------------------------------------------------------------------
        return _build_domain_output(
            url=image.url,
            scene_dominant=scene_dominant,
            scene_confidence=scene_confidence,
            face_dominant=face_dominant,
            face_confidence=face_confidence,
            final_emotion=final_emotion,
            final_source=final_source,
            final_confidence=final_confidence,
            final_scores=final_scores,
            face_count=face_count,
            scene_type=scene_type,
            clip_model=clip_analyzer.get_clip_model_name(),
            fer_model=fer_result.get("model", "fer2013"),
        )

    except Exception as e:
        logger.exception(f"Error analyzing image {image.url}: {e}")
        return {
            "url": image.url,
            "error": str(e),
            "retryable": True
        }


async def analyze_multiple_images(images: List[ImageInput]) -> List[dict]:
    if not images:
        return []

    import asyncio
    tasks = [analyze_single_image(image) for image in images]
    results = await asyncio.gather(*tasks)

    return list(results)


# =============================================================================
# DOMAIN OUTPUT BUILDER
# =============================================================================

def _build_domain_output(
    url: str,
    scene_dominant: str,
    scene_confidence: float,
    face_dominant: str | None,
    face_confidence: float | None,
    final_emotion: str,
    final_source: str,
    final_confidence: float,
    final_scores: Dict[str, float],
    face_count: int,
    scene_type: str,
    clip_model: str,
    fer_model: str,
) -> dict:

    return {
        "url": url,

        "finalEmotion": final_emotion,
        "finalSource": final_source,
        "finalConfidence": round(final_confidence, 4),

        # 🔥 ADD DISTRIBUTIONS
        "finalScores": final_scores,

        "sceneType": scene_type,
        "sceneContext": _derive_scene_context(scene_type),
        "hasHuman": face_count > 0,
        "faceCount": face_count,

        "sceneDominant": scene_dominant,
        "sceneConfidence": round(scene_confidence, 4),

        "faceDominant": face_dominant,
        "faceConfidence": (
            round(face_confidence, 4) if face_confidence is not None else None
        ),

        "analysisMetadata": {
            "pipelineVersion": PIPELINE_VERSION,
            "semanticVersion": SEMANTIC_VERSION,
            "clipModel": clip_model,
            "ferModel": fer_model,
        },
    }



# =============================================================================
# HELPERS
# =============================================================================

def _get_dominant_emotion(
    emotion_scores: Dict[str, float],
    min_confidence: float = 0.35
) -> str:

    if not emotion_scores:
        return "neutral"

    emotion, score = max(emotion_scores.items(), key=lambda x: x[1])

    if score < min_confidence:
        return "neutral"

    return emotion


def _derive_scene_context(scene_type: str) -> str:

    if "portrait" in scene_type:
        return "portrait"

    if scene_type in ["social_gathering", "group_scene"]:
        return "group"

    return "environment"


def _determine_scene_type(
    final_emotion: str,
    face_count: int
) -> str:

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

    if face_count > 2:
        if final_emotion in ["joy", "surprise"]:
            return "social_gathering"
        return "group_scene"

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

    normalized = {}

    for raw_label, score in raw_emotions.items():
        enum = normalize_image_label(raw_label)
        key = enum.value
        normalized[key] = normalized.get(key, 0.0) + score

    return {k: round(v, 4) for k, v in normalized.items()}
