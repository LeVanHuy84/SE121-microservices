# app/modules/analysis/services/ml_models/text_emotion/text_emotion_classifier.py

"""
Text Emotion Classification Engine
- Multi-Sentence Weighted Hybrid Pooling (Length-weighted Average + Max Pooling)
- Soft Multi-Label Extraction (Primary + Secondary Emotions via Dynamic Thresholding)
- PhoBERT Fine-Tuned Model Integration (huyleit/phobert-emotion-social)
- Language-gated (Vietnamese only)
"""

import math
import logging
import numpy as np
import torch
import torch.nn.functional as F

from .phobert_emotion_model import phobert_emotion_model
from .text_preprocessor import preprocess_single_sentence, split_sentences
from .language_detector import detect_language
from ....utils.exceptions import RetryableException

logger = logging.getLogger(__name__)

# Canonical Label Mapping aligned with PhoBERT fine-tuned model
LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

LABEL_MAP_CANONICAL = {
    "Enjoyment": "joy",
    "Sadness": "sadness",
    "Disgust": "disgust",
    "Anger": "anger",
    "Fear": "fear",
    "Surprise": "surprise",
    "Other": "neutral"
}


class TextEmotionClassifier:
    """
    Production-ready Multi-label Emotion Classifier for Vietnamese Social Media.
    Applies Hybrid Pooling across sentences and dynamic thresholding for multi-label outputs.
    """

    @staticmethod
    def classify(text: str) -> dict:
        if not text or not text.strip():
            return TextEmotionClassifier._build_fallback_result(text, "empty_text")

        # ---------------------------------------------------------------------
        # 1. Language detection (fail-closed for non-Vietnamese)
        # ---------------------------------------------------------------------
        lang = detect_language(text)
        if lang is not None and lang != "vi":
            return TextEmotionClassifier._build_fallback_result(text, "non_vietnamese", lang)

        # ---------------------------------------------------------------------
        # 2. Sentence Splitting
        # ---------------------------------------------------------------------
        raw_sentences = split_sentences(text)
        if not raw_sentences:
            return TextEmotionClassifier._build_fallback_result(text, "no_sentences")

        # ---------------------------------------------------------------------
        # 3. Model Loading
        # ---------------------------------------------------------------------
        if not phobert_emotion_model.is_loaded():
            phobert_emotion_model.initialize()

        tokenizer = phobert_emotion_model.get_tokenizer()
        model = phobert_emotion_model.get_model()
        device = phobert_emotion_model.device or ("cuda" if torch.cuda.is_available() else "cpu")

        # ---------------------------------------------------------------------
        # 4. Per-Sentence Inference & Hybrid Pooling
        # ---------------------------------------------------------------------
        sentence_results = []
        sentence_probs = []
        sentence_weights = []

        try:
            for sent_text in raw_sentences:
                prep_sent = preprocess_single_sentence(sent_text, apply_word_tokenize=True)
                if not prep_sent:
                    continue

                inputs = tokenizer(
                    prep_sent,
                    return_tensors="pt",
                    truncation=True,
                    max_length=128
                ).to(device)

                with torch.no_grad():
                    outputs = model(**inputs)
                    logits = outputs.logits
                    probs = F.softmax(logits, dim=1)[0].cpu().numpy()

                sentence_probs.append(probs)

                # Length weight: log(1 + word_count) to prevent ultra-long sentence dominance
                word_count = len(sent_text.split())
                w = math.log(1 + word_count)
                sentence_weights.append(w)

                # Timeline tracking per sentence
                sent_top_idx = int(np.argmax(probs))
                sentence_results.append({
                    "rawText": sent_text,
                    "processedText": prep_sent,
                    "dominantEmotion": LABEL_NAMES[sent_top_idx],
                    "confidence": float(probs[sent_top_idx])
                })

        except Exception as e:
            logger.error(f"PhoBERT inference runtime error: {e}")
            raise RetryableException(f"PhoBERT inference failed: {e}")

        if not sentence_probs:
            return TextEmotionClassifier._build_fallback_result(text, "preprocessing_failed")

        sentence_probs = np.array(sentence_probs)  # Shape: (N, 7)
        sentence_weights = np.array(sentence_weights)
        weight_sum = np.sum(sentence_weights)

        if weight_sum > 0:
            norm_weights = sentence_weights / weight_sum
        else:
            norm_weights = np.ones(len(sentence_weights)) / len(sentence_weights)

        # Length-weighted Average Pooling
        weighted_avg_probs = np.sum(sentence_probs * norm_weights[:, np.newaxis], axis=0)

        # Max Pooling (Capture peak emotional outbursts)
        max_probs = np.max(sentence_probs, axis=0)

        # Hybrid Pooling: 50% Peak + 50% Length-weighted Average Tone
        alpha = 0.5
        hybrid_probs = alpha * max_probs + (1 - alpha) * weighted_avg_probs

        # Re-normalize to probability sum = 1.0
        final_probs = hybrid_probs / np.sum(hybrid_probs)

        # ---------------------------------------------------------------------
        # 5. Dynamic Soft Multi-Label Extraction
        # ---------------------------------------------------------------------
        sorted_indices = np.argsort(final_probs)[::-1]
        primary_idx = sorted_indices[0]
        primary_emotion_raw = LABEL_NAMES[primary_idx]
        primary_prob = float(final_probs[primary_idx])

        # Dynamic Threshold: max(10%, primary_prob * 0.45)
        dynamic_threshold = max(0.10, primary_prob * 0.45)

        secondary_emotions_raw = []
        for idx in sorted_indices[1:]:
            prob = float(final_probs[idx])
            label_name = LABEL_NAMES[idx]
            if prob >= dynamic_threshold:
                secondary_emotions_raw.append(label_name)

        # Canonical score dictionary
        emotion_scores_canonical = {}
        for idx, label_name in enumerate(LABEL_NAMES):
            canonical = LABEL_MAP_CANONICAL.get(label_name, label_name.lower())
            emotion_scores_canonical[canonical] = round(float(final_probs[idx]), 4)

        primary_canonical = LABEL_MAP_CANONICAL.get(primary_emotion_raw, primary_emotion_raw.lower())
        secondary_canonical = [LABEL_MAP_CANONICAL.get(e, e.lower()) for e in secondary_emotions_raw]

        return {
            "dominantEmotion": primary_canonical,
            "primaryEmotion": primary_canonical,
            "secondaryEmotions": secondary_canonical,
            "emotionScores": emotion_scores_canonical,
            "confidence": round(primary_prob, 4),
            "meta": {
                "language": lang or "vi",
                "sentenceCount": len(raw_sentences),
                "sentenceTimeline": sentence_results,
                "dynamicThreshold": round(dynamic_threshold, 4)
            },
            "model": phobert_emotion_model.get_model_name()
        }

    @staticmethod
    def _build_fallback_result(text: str, reason: str, lang: str = "unknown") -> dict:
        scores = {v: (1.0 if v == "neutral" else 0.0) for v in LABEL_MAP_CANONICAL.values()}
        return {
            "dominantEmotion": "neutral",
            "primaryEmotion": "neutral",
            "secondaryEmotions": [],
            "emotionScores": scores,
            "confidence": 0.3,
            "meta": {
                "language": lang,
                "skipped": True,
                "reason": reason
            },
            "model": phobert_emotion_model.get_model_name()
        }


# Singleton instance
text_emotion_classifier = TextEmotionClassifier()
