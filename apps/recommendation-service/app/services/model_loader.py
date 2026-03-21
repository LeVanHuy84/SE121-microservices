import logging
from typing import List

import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

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
            "[RecommendationModelLoader] Loading embedding model %s to %s",
            settings.RECOMMENDATION_MODEL_NAME,
            self._device,
        )
        self._tokenizer = AutoTokenizer.from_pretrained(
            settings.RECOMMENDATION_MODEL_NAME
        )
        self._model = AutoModel.from_pretrained(settings.RECOMMENDATION_MODEL_NAME)
        self._model.to(self._device)
        self._model.eval()
        logger.info("[RecommendationModelLoader] Model loaded")

    def warmup(self):
        logger.info("[RecommendationModelLoader] Warming up model")
        try:
            _ = self.predict_similarity_scores(
                "name: viewer example\nbio: likes technology and football",
                [
                    "name: candidate example\nbio: builds mobile apps and joins football groups"
                ],
            )
            logger.info("[RecommendationModelLoader] Warmup completed")
        except Exception as exc:
            logger.exception("[RecommendationModelLoader] Warmup failed: %s", exc)

    def predict_similarity_scores(
        self, query_text: str, candidate_texts: List[str]
    ) -> List[float]:
        if not query_text or not candidate_texts:
            return []

        embeddings = self._encode_texts([query_text, *candidate_texts])
        if embeddings.shape[0] <= 1:
            return []

        query_embedding = embeddings[0:1]
        candidate_embeddings = embeddings[1:]
        similarity_scores = torch.matmul(candidate_embeddings, query_embedding.T).squeeze(
            -1
        )
        normalized_scores = ((similarity_scores + 1.0) / 2.0).clamp(0.0, 1.0)
        return [float(score) for score in normalized_scores.detach().cpu().tolist()]

    def _encode_texts(self, texts: List[str]) -> torch.Tensor:
        if not texts:
            return torch.empty((0, 1), dtype=torch.float32)

        batches: List[torch.Tensor] = []
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

            pooled = self._mean_pool(outputs.last_hidden_state, inputs["attention_mask"])
            normalized = F.normalize(pooled, p=2, dim=1)
            batches.append(normalized.detach().cpu())

        return torch.cat(batches, dim=0)

    def _mean_pool(
        self, last_hidden_state: torch.Tensor, attention_mask: torch.Tensor
    ) -> torch.Tensor:
        mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        masked_embeddings = last_hidden_state * mask
        summed = masked_embeddings.sum(dim=1)
        counts = mask.sum(dim=1).clamp(min=1e-9)
        return summed / counts


model_loader = ModelLoader()
