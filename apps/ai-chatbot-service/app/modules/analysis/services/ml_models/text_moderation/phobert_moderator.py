import logging
import torch
import torch.nn.functional as F
from transformers import AutoTokenizer, AutoModelForSequenceClassification

from app.core.settings import settings

logger = logging.getLogger(__name__)


class PhoBERTModerator:
    """
    Binary violation detector.
    Output:
      - violation_score: float [0,1]
    """

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
            logger.info(f"[PhoBERTModerator] Loading binary moderation model: {self.model_name}")

            self.tokenizer = AutoTokenizer.from_pretrained(self.model_name)
            self.model = AutoModelForSequenceClassification.from_pretrained(
                self.model_name
            )

            self.device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model.to(self.device)
            self.model.eval()

            self.initialized = True
            logger.info(f"[PhoBERTModerator] Binary model loaded successfully on {self.device}")

        except Exception:
            logger.exception("[PhoBERTModerator] Load failed")
            self.model = None

    def infer(self, text: str) -> dict:
        """
        Returns:
        {
          available: bool,
          violation_score: float | None,
          model: str
        }
        """
        if not self.model:
            return {
                "available": False,
                "violation_score": None,
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

        # label mapping:
        # 0 = safe
        # 1 = violation
        violation_score = float(probs[1])

        return {
            "available": True,
            "violation_score": violation_score,
            "model": "phobert_binary",
        }


# ---------- Singleton + ensure ----------
phobert_moderator = PhoBERTModerator()


def ensure_phobert_moderator_loaded() -> PhoBERTModerator:
    if not phobert_moderator.initialized:
        phobert_moderator.initialize()
    return phobert_moderator
