import logging
from typing import List

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from app.core.config import settings

logger = logging.getLogger(__name__)


class ModelLoader:
    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info("[RecommendationModelLoader] Using device: %s", self._device)

    @property
    def tokenizer(self):
        if self._tokenizer is None:
            self._load_model()
        return self._tokenizer

    @property
    def model(self):
        if self._model is None:
            self._load_model()
        return self._model

    def _load_model(self):
        if self._model is not None:
            return

        logger.info(
            "[RecommendationModelLoader] Loading model %s to %s",
            settings.RECOMMENDATION_MODEL_NAME,
            self._device,
        )
        self._tokenizer = AutoTokenizer.from_pretrained(
            settings.RECOMMENDATION_MODEL_NAME
        )
        self._model = AutoModelForSequenceClassification.from_pretrained(
            settings.RECOMMENDATION_MODEL_NAME
        )
        self._model.to(self._device)
        self._model.eval()
        logger.info("[RecommendationModelLoader] Model loaded")

    def warmup(self):
        logger.info("[RecommendationModelLoader] Warming up model")
        try:
            dummy_inputs = self.tokenizer(
                ["viewer=user-a candidate=user-b mutual=2 common_groups=1 base_score=20 reasons=2 mutual friends"],
                padding=True,
                truncation=True,
                max_length=settings.RECOMMENDATION_MAX_LENGTH,
                return_tensors="pt",
            )
            dummy_inputs = {
                key: value.to(self._device) for key, value in dummy_inputs.items()
            }
            with torch.no_grad():
                _ = self.model(**dummy_inputs)
            logger.info("[RecommendationModelLoader] Warmup completed")
        except Exception as exc:
            logger.exception("[RecommendationModelLoader] Warmup failed: %s", exc)

    def predict_scores(self, texts: List[str]) -> List[float]:
        if not texts:
            return []

        scores: List[float] = []
        batch_size = max(1, settings.RECOMMENDATION_BATCH_SIZE)

        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            inputs = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=settings.RECOMMENDATION_MAX_LENGTH,
                return_tensors="pt",
            )
            inputs = {key: value.to(self._device) for key, value in inputs.items()}

            with torch.no_grad():
                outputs = self.model(**inputs)

            logits = outputs.logits.detach().cpu()
            if logits.ndim == 1:
                logits = logits.unsqueeze(-1)

            if logits.shape[-1] == 1:
                batch_scores = torch.sigmoid(logits.squeeze(-1)).tolist()
            else:
                probabilities = torch.softmax(logits, dim=-1)
                batch_scores = probabilities[:, -1].tolist()

            scores.extend(float(score) for score in batch_scores)

        return scores


model_loader = ModelLoader()
