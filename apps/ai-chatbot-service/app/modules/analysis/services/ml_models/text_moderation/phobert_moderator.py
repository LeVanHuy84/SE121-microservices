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
        if not self.model:
            return {
                "available": False,
                "predicted_label": "CLEAN",
                "predicted_class_id": 0,
                "confidence": 1.0,
                "all_scores": {"CLEAN": 1.0, "PROFANITY_VENTING": 0.0, "HATE_SPEECH": 0.0, "EMOTIONAL_CRISIS": 0.0},
                "model": "phobert_unavailable",
            }

        inputs = self.tokenizer(
            text,
            return_tensors="pt",
            truncation=True,
            max_length=256,
            padding=True,
        ).to(self.device)

        with torch.no_grad():
            logits = self.model(**inputs).logits
            probs = F.softmax(logits, dim=-1)[0]

        num_classes = probs.shape[0]
        if num_classes == 4:
            class_id = int(torch.argmax(probs).item())
            confidence = float(probs[class_id])
            scores_dict = {
                self.LABEL_MAPPING[i]: round(float(probs[i]), 4)
                for i in range(4)
            }
            pred_label = self.LABEL_MAPPING.get(class_id, "CLEAN")
        else:
            # Fallback for binary model if legacy model loaded
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
            "model": "phobert_multiclass",
        }


# ---------- Singleton + ensure ----------
phobert_moderator = PhoBERTModerator()


def ensure_phobert_moderator_loaded() -> PhoBERTModerator:
    if not phobert_moderator.initialized:
        phobert_moderator.initialize()
    return phobert_moderator

