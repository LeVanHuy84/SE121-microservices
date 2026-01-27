# app/services/ai/text_emotion/text_emotion_classifier.py

"""
Text Emotion Classification
- PhoBERT-based emotion detection (Vietnamese only)
- Social media optimized (emoji, slang aware)
- Language-gated to avoid invalid inference
- Confidence-thresholded emotion decision
"""

import logging
import torch
import torch.nn.functional as F

from app.services.ai.text_emotion.phobert_emotion_model import phobert_emotion_model
from app.services.ai.text_emotion.text_preprocessor import normalize_text
from app.services.ai.text_emotion.language_detector import detect_language
from app.services.domain.emotion import normalize_text_label
from app.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)

# Emotion-specific confidence thresholds
EMOTION_CONFIDENCE_THRESHOLDS = {
    "joy": 0.55,
    "sadness": 0.6,
    "surprise": 0.6,
    "fear": 0.65,
    "anger": 0.65,
    "disgust": 0.7,
}

DEFAULT_THRESHOLD = 0.6


class TextEmotionClassifier:
    """
    Text emotion classifier optimized for social media.
    - Emoji + slang aware
    - Vietnamese-only (PhoBERT)
    - Fail-closed language gating
    - Confidence-aware decision policy
    """

    @staticmethod
    def classify(text: str) -> dict:
        """
        Classify emotion in text.
        """
        # ---------------------------------------------------------------------
        # Preprocess
        # ---------------------------------------------------------------------
        prep = normalize_text(text)
        clean_text = prep["text"]

        # ---------------------------------------------------------------------
        # Language detection
        # ---------------------------------------------------------------------
        lang = detect_language(clean_text)

        # Gate non-Vietnamese (fail-closed)
        if lang is not None and lang != "vi":
            return {
                "dominantEmotion": "neutral",
                "emotionScores": {
                    "neutral": 1.0
                },
                "confidence": 0.3,
                "meta": {
                    "language": lang or "unknown",
                    "hasEmoji": prep["hasEmoji"],
                    "skipped": True
                },
                "model": "phobert_mxh_ensemble"
            }

        # ---------------------------------------------------------------------
        # Model loading
        # ---------------------------------------------------------------------
        if not phobert_emotion_model.is_loaded():
            phobert_emotion_model.initialize()

        tokenizer = phobert_emotion_model.get_tokenizer()
        model = phobert_emotion_model.get_model()

        # ---------------------------------------------------------------------
        # Tokenization
        # ---------------------------------------------------------------------
        inputs = tokenizer(
            clean_text,
            return_tensors="pt",
            truncation=True,
            max_length=256
        )

        # ---------------------------------------------------------------------
        # Inference
        # ---------------------------------------------------------------------
        try:
            with torch.no_grad():
                outputs = model(**inputs)
        except RuntimeError as e:
            logger.error(f"PhoBERT runtime error: {e}")
            raise RetryableException(str(e))

        # ---------------------------------------------------------------------
        # Softmax probabilities
        # ---------------------------------------------------------------------
        probs = F.softmax(outputs.logits, dim=1)[0].tolist()
        labels = model.config.id2label

        # ---------------------------------------------------------------------
        # Map to canonical emotions
        # ---------------------------------------------------------------------
        emotion_scores: dict[str, float] = {}
        for i, prob in enumerate(probs):
            canonical = normalize_text_label(labels[i])
            emotion_scores.setdefault(canonical.value, 0.0)
            emotion_scores[canonical.value] += float(prob)

        # Normalize (safety)
        total = sum(emotion_scores.values())
        if total > 0:
            emotion_scores = {k: v / total for k, v in emotion_scores.items()}

        # ---------------------------------------------------------------------
        # Decision layer (threshold-based)
        # ---------------------------------------------------------------------
        dominant = max(emotion_scores, key=emotion_scores.get)
        confidence = emotion_scores[dominant]

        threshold = EMOTION_CONFIDENCE_THRESHOLDS.get(
            dominant,
            DEFAULT_THRESHOLD
        )

        # Low-confidence → neutral
        if confidence < threshold:
            return {
                "dominantEmotion": "neutral",
                "emotionScores": {
                    "neutral": 1.0
                },
                "confidence": round(confidence, 4),
                "meta": {
                    "language": lang or "unknown",
                    "hasEmoji": prep["hasEmoji"],
                    "lowConfidence": True,
                    "originalEmotion": dominant
                },
                "model": "phobert_mxh_ensemble"
            }

        # ---------------------------------------------------------------------
        # Final output (confident emotion)
        # ---------------------------------------------------------------------
        return {
            "dominantEmotion": dominant,
            "emotionScores": {
                k: round(v, 4) for k, v in emotion_scores.items()
            },
            "confidence": round(confidence, 4),
            "meta": {
                "language": lang or "unknown",
                "hasEmoji": prep["hasEmoji"]
            },
            "model": "phobert_mxh_ensemble"
        }


# Singleton instance
text_emotion_classifier = TextEmotionClassifier()
