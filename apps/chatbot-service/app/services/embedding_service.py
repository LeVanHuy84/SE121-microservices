from __future__ import annotations

from typing import Sequence

import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

from app.core.config import settings


class EmbeddingService:
    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._device = "cuda" if torch.cuda.is_available() else "cpu"

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode(texts, prefix="passage")

    def encode_query(self, text: str) -> list[float]:
        embeddings = self._encode([text], prefix="query")
        return embeddings[0] if embeddings else []

    def _encode(self, texts: Sequence[str], prefix: str) -> list[list[float]]:
        normalized = [self._format_text(text, prefix) for text in texts if text.strip()]
        if not normalized:
            return []

        tokenizer, model = self._load()
        embeddings: list[list[float]] = []
        for start in range(0, len(normalized), settings.EMBEDDING_BATCH_SIZE):
            batch = normalized[start : start + settings.EMBEDDING_BATCH_SIZE]
            encoded = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=settings.EMBEDDING_MAX_LENGTH,
                return_tensors="pt",
            ).to(self._device)
            with torch.inference_mode():
                output = model(**encoded)
            pooled = self._average_pool(
                output.last_hidden_state,
                encoded["attention_mask"],
            )
            pooled = F.normalize(pooled, p=2, dim=1)
            embeddings.extend(
                [[float(value) for value in row] for row in pooled.cpu().tolist()]
            )
        return embeddings

    def _load(self):
        if self._tokenizer is None or self._model is None:
            self._tokenizer = AutoTokenizer.from_pretrained(settings.EMBEDDING_MODEL_NAME)
            self._model = AutoModel.from_pretrained(settings.EMBEDDING_MODEL_NAME)
            self._model.to(self._device)
            self._model.eval()
        return self._tokenizer, self._model

    def _average_pool(
        self,
        last_hidden_state: torch.Tensor,
        attention_mask: torch.Tensor,
    ) -> torch.Tensor:
        mask = attention_mask.unsqueeze(-1).expand(last_hidden_state.size()).float()
        masked_embeddings = last_hidden_state * mask
        summed = masked_embeddings.sum(dim=1)
        counts = mask.sum(dim=1).clamp(min=1e-9)
        return summed / counts

    def _format_text(self, text: str, prefix: str) -> str:
        normalized = " ".join(text.split())
        model_name = settings.EMBEDDING_MODEL_NAME.lower()
        if "e5" in model_name and not normalized.startswith(
            ("query: ", "passage: ")
        ):
            return f"{prefix}: {normalized}"
        return normalized


embedding_service = EmbeddingService()
