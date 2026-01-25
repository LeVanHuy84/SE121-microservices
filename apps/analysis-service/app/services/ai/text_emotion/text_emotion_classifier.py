# app/services/ai/text_emotion/text_emotion_classifier.py

"""
Text Emotion Classification
- PhoBERT-based emotion detection
- Social media optimized (emoji, slang aware)
- Context-aware (post vs comment)
"""

import logging
import torch
import torch.nn.functional as F

from app.services.ai.text_emotion.phobert_emotion_model import phobert_emotion_model
from app.services.ai.text_emotion.text_preprocessor import normalize_text
from app.services.ai.text_emotion.text_sarcasm_detector import detect_sarcasm
from app.services.domain.emotion import normalize_text_label
from app.utils.exceptions import RetryableException

logger = logging.getLogger(__name__)


class TextEmotionClassifier:
    """
    Text emotion classifier optimized for social media.
    - Emoji + slang aware
    - Context-aware (post vs comment)
    - Heuristic boost for better accuracy
    """

    @staticmethod
    def classify(text: str) -> dict:
        """
        Classify emotion in text.
        
        Args:
            text: Text content to classify
            
        Returns:
            {
                "dominantEmotion": str,
                "emotionScores": dict,
                "confidence": float,
                "meta": dict,
                "model": str
            }
        """
        # Preprocess text
        prep = normalize_text(text)
        clean_text = prep["text"]

        # Detect sarcasm
        sarcasm = detect_sarcasm(clean_text)
        
        # Determine text type
        word_count = len(clean_text.split())
        text_type = "comment" if word_count < 6 else "post"

        # Ensure model is loaded
        if not phobert_emotion_model.is_loaded():
            phobert_emotion_model.initialize()

        # Get model and tokenizer
        tokenizer = phobert_emotion_model.get_tokenizer()
        model = phobert_emotion_model.get_model()

        # Tokenize
        inputs = tokenizer(clean_text, return_tensors="pt", truncation=True, max_length=256)

        # Inference
        try:
            with torch.no_grad():
                outputs = model(**inputs)
        except RuntimeError as e:
            logger.error(f"PhoBERT runtime error: {e}")
            raise RetryableException(f"PhoBERT runtime error: {str(e)}")

        # Get probabilities
        probs = F.softmax(outputs.logits, dim=1)[0].tolist()
        labels = model.config.id2label

        # Map to canonical emotions
        emotion_scores = {}
        for i, prob in enumerate(probs):
            canonical = normalize_text_label(labels[i])
            emotion_scores.setdefault(canonical.value, 0.0)
            emotion_scores[canonical.value] += float(prob)

        # Normalize scores
        total = sum(emotion_scores.values())
        if total > 0:
            emotion_scores = {k: v / total for k, v in emotion_scores.items()}

        # Heuristic boost for comments (more expressive)
        if text_type == "comment":
            emotion_scores = {k: min(v * 1.1, 1.0) for k, v in emotion_scores.items()}

        # Sarcasm handling (invert joy/anger)
        if sarcasm:
            emotion_scores["anger"] = min(emotion_scores.get("anger", 0) + 0.15, 1.0)
            emotion_scores["joy"] = emotion_scores.get("joy", 0) * 0.6

        # Re-normalize after adjustments
        total = sum(emotion_scores.values())
        if total > 0:
            emotion_scores = {k: v / total for k, v in emotion_scores.items()}

        # Get dominant emotion
        dominant = max(emotion_scores, key=emotion_scores.get)
        confidence = emotion_scores[dominant]

        return {
            "dominantEmotion": dominant,
            "emotionScores": {k: round(v, 4) for k, v in emotion_scores.items()},
            "confidence": round(confidence, 4),
            "meta": {
                "textType": text_type,
                "sarcasm": sarcasm,
                "hasEmoji": prep["hasEmoji"]
            },
            "model": "phobert_mxh_ensemble"
        }


# Singleton instance
text_emotion_classifier = TextEmotionClassifier()
