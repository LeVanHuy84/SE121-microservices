from app.services.model_loader import model_loader
import torch.nn.functional as F
import torch
from app.utils.emotion_normalizer import normalize_text_label
from app.enums.emotion_enum import EmotionEnum
from app.utils.exceptions import RetryableException

class TextClassifier:
    @staticmethod
    def classify_emotion(text: str):
        tokenizer = model_loader.tokenizer
        model = model_loader.model

        inputs = tokenizer(text, return_tensors="pt")

        try:
            with torch.no_grad():
                outputs = model(**inputs)
        except RuntimeError as e:
            # Lỗi torch tạm thời → retry được
            raise RetryableException(f"PhoBERT runtime error: {str(e)}")

        logits = outputs.logits
        probs = F.softmax(logits, dim=1)[0].tolist()

        labels = model.config.id2label

        # Normalize scores to canonical emotions
        emotion_scores = {}
        for i, prob in enumerate(probs):
            raw_label = labels[i]
            canonical_label = normalize_text_label(raw_label)
            emotion_scores.setdefault(canonical_label, 0)
            emotion_scores[canonical_label] += float(round(prob, 4))

        # Dominant emotion
        dominant = max(emotion_scores, key=emotion_scores.get)

        return {
            "dominant_emotion": dominant.value,
            "emotion_scores": {k.value: v for k, v in emotion_scores.items()}
        }

text_classifier = TextClassifier()

