import logging
import torch
import torch.nn.functional as F
from typing import Dict, Any
from transformers import AutoTokenizer, AutoModelForSequenceClassification

from app.core.settings import settings

logger = logging.getLogger(__name__)


class PhoBERTModerator:
    """
    Multi-class PhoBERT Moderation Detector (4 Context Labels).
    Labels:
      0: CLEAN (Sạch, an toàn)
      1: PROFANITY_VENTING (Từ chửi thề nhẹ / Bộc phát xả stress)
      2: HATE_SPEECH (Ngôn từ thù ghét / Công kích cá nhân)
      3: EMOTIONAL_CRISIS (Khủng hoảng cảm xúc / Trầm cảm / Tự hại)
    """

    LABEL_MAPPING = {
        0: "CLEAN",
        1: "PROFANITY_VENTING",
        2: "HATE_SPEECH",
        3: "EMOTIONAL_CRISIS"
    }

    def __init__(self):
        self.tokenizer = None
        self.model = None
        self.device = None
        self.initialized = False
        self.model_name = settings.PHOBERT_MODERATION_MODEL_PATH

    def initialize(self):
        if self.initialized:
            return

        try:
            logger.info(f"[PhoBERTModerator] Loading 4-class moderation model: {self.model_name}")

            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self.model = AutoModelForSequenceClassification.from_pretrained(
                self.model_name
            )

            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model.to(self.device)
            self.model.eval()

            self.initialized = True
            logger.info(f"[PhoBERTModerator] 4-class model loaded successfully on {self.device}")

        except Exception as e:
            logger.warning(f"[PhoBERTModerator] Load failed for {self.model_name}: {e}. Fallback enabled.")
            self.model = None

    SEVERITY_PRIORITY = {
        "HATE_SPEECH": 3,
        "EMOTIONAL_CRISIS": 2,
        "PROFANITY_VENTING": 1,
        "CLEAN": 0
    }

    def infer(self, text: str) -> Dict[str, Any]:
        """
        Returns:
        {
          available: bool,
          predicted_label: str,
          predicted_class_id: int,
          confidence: float,
          all_scores: Dict[str, float],
          model: str
        }
        """
        if not text or not text.strip():
            return {
                "available": True,
                "predicted_label": "CLEAN",
                "predicted_class_id": 0,
                "confidence": 1.0,
                "all_scores": {"CLEAN": 1.0, "PROFANITY_VENTING": 0.0, "HATE_SPEECH": 0.0, "EMOTIONAL_CRISIS": 0.0},
                "model": "phobert_empty_text",
            }

        if not self.model:
            return {
                "available": False,
                "predicted_label": "CLEAN",
                "predicted_class_id": 0,
                "confidence": 1.0,
                "all_scores": {"CLEAN": 1.0, "PROFANITY_VENTING": 0.0, "HATE_SPEECH": 0.0, "EMOTIONAL_CRISIS": 0.0},
                "model": "phobert_unavailable",
            }

        # Sentence splitting to avoid token truncation loss on long texts
        from app.modules.analysis.services.ml_models.text_emotion.text_preprocessor import (
            split_sentences,
            preprocess_single_sentence
        )

        raw_sentences = split_sentences(text)
        processed_sentences = []
        for s in raw_sentences:
            prep_s = preprocess_single_sentence(s, apply_word_tokenize=True)
            if prep_s:
                processed_sentences.append(prep_s)

        if not processed_sentences:
            processed_sentences = [text]

        # Batch Tokenization & Forward Pass
        inputs = self.tokenizer(
            processed_sentences,
            return_tensors="pt",
            truncation=True,
            max_length=256,
            padding=True,
        ).to(self.device)

        with torch.no_grad():
            logits = self.model(**inputs).logits
            probs_batch = F.softmax(logits, dim=-1)

        # Batch Aggregation across sentences
        num_classes = probs_batch.shape[-1]
        
        if num_classes == 4:
            # Multi-class 4-label model
            best_label = "CLEAN"
            best_class_id = 0
            best_confidence = 0.0
            highest_priority = -1

            # Max score across sentences for each label
            max_scores_per_label = {self.LABEL_MAPPING[i]: 0.0 for i in range(4)}

            for i in range(probs_batch.shape[0]):
                sent_probs = probs_batch[i]
                sent_class_id = int(torch.argmax(sent_probs).item())
                sent_label = self.LABEL_MAPPING.get(sent_class_id, "CLEAN")
                sent_conf = float(sent_probs[sent_class_id])

                # Update max scores per label
                for label_idx in range(4):
                    lbl_name = self.LABEL_MAPPING[label_idx]
                    lbl_prob = float(sent_probs[label_idx])
                    if lbl_prob > max_scores_per_label[lbl_name]:
                        max_scores_per_label[lbl_name] = round(lbl_prob, 4)

                # Max Severity Aggregation Priority Check
                priority = self.SEVERITY_PRIORITY.get(sent_label, 0)
                if priority > highest_priority or (priority == highest_priority and sent_conf > best_confidence):
                    highest_priority = priority
                    best_label = sent_label
                    best_class_id = sent_class_id
                    best_confidence = sent_conf

            return {
                "available": True,
                "predicted_label": best_label,
                "predicted_class_id": best_class_id,
                "confidence": round(best_confidence, 4),
                "all_scores": max_scores_per_label,
                "model": "phobert_multiclass_longtext",
            }
        else:
            # Fallback for binary model
            probs = probs_batch[0]
            violation_score = float(probs[1]) if num_classes > 1 else 0.0
            if violation_score >= 0.7:
                class_id = 2
                pred_label = "HATE_SPEECH"
                confidence = violation_score
            else:
                class_id = 0
                pred_label = "CLEAN"
                confidence = 1.0 - violation_score

            scores_dict = {
                "CLEAN": round(1.0 - violation_score, 4),
                "PROFANITY_VENTING": 0.0,
                "HATE_SPEECH": round(violation_score, 4),
                "EMOTIONAL_CRISIS": 0.0
            }

            return {
                "available": True,
                "predicted_label": pred_label,
                "predicted_class_id": class_id,
                "confidence": round(confidence, 4),
                "all_scores": scores_dict,
                "model": "phobert_binary",
            }


# ---------- Singleton + ensure ----------
phobert_moderator = PhoBERTModerator()


def ensure_phobert_moderator_loaded() -> PhoBERTModerator:
    if not phobert_moderator.initialized:
        phobert_moderator.initialize()
    return phobert_moderator

