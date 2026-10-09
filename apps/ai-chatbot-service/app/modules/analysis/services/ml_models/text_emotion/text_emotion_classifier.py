# app/modules/analysis/services/ml_models/text_emotion/text_emotion_classifier.py

"""
Text Emotion Classification Engine using PhoBERT ONNX Runtime (FP32)
- Hierarchical Global-Local Fusion (Ensemble of Full Text Global Context + Per-Sentence Details)
- Adaptive Length Routing (Direct inference for short texts, Segmented Hybrid Pooling for long texts)
- Soft Multi-Label Extraction (Primary + Secondary Emotions via Dynamic Thresholding)
- PhoBERT Fine-Tuned Model Integration (huyleit/phobert-emotion-social)
- Language-gated (Vietnamese only)
"""

import math
import logging
import numpy as np

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
    Production-ready Emotion Classifier for Vietnamese Social Media.
    Combines Full-Text Global View with Sentence-Level Granularity to prevent 
    truncation while preserving holistic context and sarcasm.
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
        # 2. Sentence Splitting & Word Count Check
        # ---------------------------------------------------------------------
        raw_sentences = split_sentences(text)
        if not raw_sentences:
            raw_sentences = [text]

        words = text.split()
        total_word_count = len(words)

        # ---------------------------------------------------------------------
        # 3. Model Loading
        # ---------------------------------------------------------------------
        if not phobert_emotion_model.is_loaded():
            phobert_emotion_model.initialize()

        tokenizer = phobert_emotion_model.get_tokenizer()
        session = phobert_emotion_model.get_session()

        if session is None:
            return TextEmotionClassifier._build_fallback_result(text, "session_unavailable")

        # Helper for ONNX single inference
        def _run_single_inference(raw_chunk: str) -> np.ndarray:
            prep = preprocess_single_sentence(raw_chunk, apply_word_tokenize=True)
            if not prep:
                return np.zeros(len(LABEL_NAMES))
            inputs = tokenizer(
                prep,
                return_tensors="np",
                truncation=True,
                max_length=128
            )
            ort_inputs = {
                "input_ids": inputs["input_ids"].astype(np.int64),
                "attention_mask": inputs["attention_mask"].astype(np.int64)
            }
            logits = session.run(None, ort_inputs)[0][0]
            exp_l = np.exp(logits - np.max(logits))
            return exp_l / np.sum(exp_l)

        try:
            # -----------------------------------------------------------------
            # 4. Global View (Full text up to 128 tokens)
            # -----------------------------------------------------------------
            global_probs = _run_single_inference(text)

            # ROUTE 1: Single sentence or short fragment (Zero-oversegmentation)
            meaningful_sentences = [s for s in raw_sentences if len(s.split()) >= 3]

            if len(meaningful_sentences) <= 1:
                final_probs = global_probs
                top_idx = int(np.argmax(final_probs))
                sentence_results = [{
                    "rawText": text,
                    "processedText": preprocess_single_sentence(text, apply_word_tokenize=True),
                    "dominantEmotion": LABEL_NAMES[top_idx],
                    "confidence": float(final_probs[top_idx])
                }]

            # ROUTE 2: Multi-Sentence Discourse (Hierarchical Global-Local Fusion)
            else:
                sentence_results = []
                sentence_probs = []
                sentence_weights = []

                for sent_text in meaningful_sentences:
                    sent_words = sent_text.split()
                    probs = _run_single_inference(sent_text)
                    if np.sum(probs) == 0:
                        continue

                    sentence_probs.append(probs)
                    w = math.log(1 + len(sent_words))
                    sentence_weights.append(w)

                    sent_top_idx = int(np.argmax(probs))
                    sentence_results.append({
                        "rawText": sent_text,
                        "processedText": preprocess_single_sentence(sent_text, apply_word_tokenize=True),
                        "dominantEmotion": LABEL_NAMES[sent_top_idx],
                        "confidence": float(probs[sent_top_idx])
                    })

                if not sentence_probs:
                    final_probs = global_probs
                else:
                    sentence_probs = np.array(sentence_probs)
                    sentence_weights = np.array(sentence_weights)
                    weight_sum = np.sum(sentence_weights)
                    norm_weights = sentence_weights / weight_sum if weight_sum > 0 else np.ones(len(sentence_weights)) / len(sentence_weights)

                    weighted_avg_probs = np.sum(sentence_probs * norm_weights[:, np.newaxis], axis=0)
                    local_max_probs = np.max(sentence_probs, axis=0)

                    # Hierarchical Fusion:
                    # 35% Global Holistic Context + 45% Local Peak Outburst + 20% Weighted Tone
                    fusion = 0.35 * global_probs + 0.45 * local_max_probs + 0.20 * weighted_avg_probs
                    final_probs = fusion / np.sum(fusion)

        except Exception as e:
            logger.error(f"PhoBERT ONNX inference runtime error: {e}")
            raise RetryableException(f"PhoBERT ONNX inference failed: {e}")

        # ---------------------------------------------------------------------
        # 5. Dynamic Soft Multi-Label Extraction
        # ---------------------------------------------------------------------
        sorted_indices = np.argsort(final_probs)[::-1]
        primary_idx = sorted_indices[0]
        primary_emotion_raw = LABEL_NAMES[primary_idx]
        primary_prob = float(final_probs[primary_idx])

        # Dynamic Threshold: max(0.18, primary_prob * 0.32)
        # Filters out trivial background noise while preserving co-occurring emotions
        dynamic_threshold = max(0.18, primary_prob * 0.32)

        secondary_emotions_raw = []
        for idx in sorted_indices[1:]:
            prob = float(final_probs[idx])
            label_name = LABEL_NAMES[idx]
            if prob >= dynamic_threshold and label_name != "Other":
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
