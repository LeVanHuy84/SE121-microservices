import logging
import re
import threading
from typing import List, Sequence

import torch
import torch.nn.functional as F
from transformers import AutoModel, AutoTokenizer

from app.core.config import settings

logger = logging.getLogger(__name__)


class ModelLoader:
    def __init__(self):
        self._tokenizer = None
        self._model = None
        self._load_lock = threading.Lock()
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._ready = False
        self._last_error: str | None = None
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

        with self._load_lock:
            if self._model is not None:
                return

            try:
                logger.info(
                    "[RecommendationModelLoader] Loading embedding model %s to %s",
                    settings.RECOMMENDATION_MODEL_NAME,
                    self._device,
                )
                self._tokenizer = AutoTokenizer.from_pretrained(
                    settings.RECOMMENDATION_MODEL_NAME
                )
                load_kwargs = {}
                if self._device == "cuda":
                    load_kwargs["torch_dtype"] = torch.float16

                self._model = AutoModel.from_pretrained(
                    settings.RECOMMENDATION_MODEL_NAME,
                    **load_kwargs,
                )
                self._model.to(self._device)
                self._model.eval()
                self._last_error = None
                logger.info("[RecommendationModelLoader] Model loaded")
            except Exception as exc:
                self._ready = False
                self._last_error = str(exc)
                self._tokenizer = None
                self._model = None
                logger.exception(
                    "[RecommendationModelLoader] Model load failed: %s", exc
                )
                raise

    def warmup(self):
        logger.info("[RecommendationModelLoader] Warming up model")
        try:
            _ = self.predict_similarity_scores(
                "name: viewer example\nbio: likes technology and football",
                [
                    (
                        "name: candidate example\nbio: builds mobile apps "
                        "and joins football groups"
                    )
                ],
            )
            self._ready = True
            self._last_error = None
            logger.info("[RecommendationModelLoader] Warmup completed")
        except Exception as exc:
            self._ready = False
            self._last_error = str(exc)
            logger.exception("[RecommendationModelLoader] Warmup failed: %s", exc)
            raise

    def is_ready(self) -> bool:
        return self._ready and self._model is not None and self._tokenizer is not None

    def get_readiness_status(self) -> dict[str, str | bool | None]:
        return {
            "ready": self.is_ready(),
            "modelName": settings.RECOMMENDATION_MODEL_NAME,
            "device": self._device,
            "lastError": self._last_error,
        }

    def predict_similarity_scores(
        self, viewer_profile_text: str, candidate_texts: List[str]
    ) -> List[float]:
        normalized_viewer_text = self._normalize_text(viewer_profile_text)
        normalized_candidate_texts = [
            self._normalize_text(text) for text in candidate_texts
        ]

        if not normalized_viewer_text:
            return [0.0 for _ in candidate_texts]

        candidate_index_by_text: dict[str, int] = {}
        unique_candidate_texts: list[str] = []
        for text in normalized_candidate_texts:
            if not text or text in candidate_index_by_text:
                continue
            candidate_index_by_text[text] = len(unique_candidate_texts)
            unique_candidate_texts.append(text)

        if not unique_candidate_texts:
            return [0.0 for _ in candidate_texts]

        query_embedding = self._encode_texts(
            [self._format_query_text(normalized_viewer_text)]
        )
        candidate_embeddings = self._encode_texts(
            [
                self._format_candidate_text(text)
                for text in unique_candidate_texts
            ]
        )

        if query_embedding.shape[0] == 0 or candidate_embeddings.shape[0] == 0:
            return [0.0 for _ in candidate_texts]

        cosine_scores = torch.matmul(candidate_embeddings, query_embedding.T).squeeze(
            -1
        )
        calibrated_unique_scores = [
            self._calibrate_cosine_score(float(score))
            for score in cosine_scores.detach().cpu().tolist()
        ]

        resolved_scores: List[float] = []
        for text in normalized_candidate_texts:
            if not text:
                resolved_scores.append(0.0)
                continue

            score_index = candidate_index_by_text[text]
            resolved_scores.append(calibrated_unique_scores[score_index])

        return resolved_scores

    def encode_profile_texts(self, profile_texts: Sequence[str]) -> List[List[float]]:
        normalized_profile_texts = [
            self._normalize_text(text) for text in profile_texts
        ]

        text_index_by_value: dict[str, int] = {}
        unique_profile_texts: list[str] = []
        for text in normalized_profile_texts:
            if not text or text in text_index_by_value:
                continue
            text_index_by_value[text] = len(unique_profile_texts)
            unique_profile_texts.append(text)

        if not unique_profile_texts:
            return [[] for _ in profile_texts]

        embeddings = self._encode_texts(unique_profile_texts)
        if embeddings.shape[0] == 0:
            return [[] for _ in profile_texts]

        embedding_values = [
            [float(value) for value in row]
            for row in embeddings.detach().cpu().tolist()
        ]
        resolved_embeddings: List[List[float]] = []

        for text in normalized_profile_texts:
            if not text:
                resolved_embeddings.append([])
                continue

            embedding_index = text_index_by_value[text]
            resolved_embeddings.append(embedding_values[embedding_index])

        return resolved_embeddings

    def get_model_metadata(self) -> dict[str, str]:
        return {
            "modelName": settings.RECOMMENDATION_MODEL_NAME,
            "device": self._device,
            "scoreFloor": str(settings.RECOMMENDATION_SCORE_FLOOR),
            "scoreCeiling": str(settings.RECOMMENDATION_SCORE_CEILING),
        }

    def _encode_texts(self, texts: Sequence[str]) -> torch.Tensor:
        if not texts:
            return torch.empty((0, 1), dtype=torch.float32)

        batches: List[torch.Tensor] = []
        batch_size = max(1, settings.RECOMMENDATION_BATCH_SIZE)

        for start in range(0, len(texts), batch_size):
            batch = list(texts[start : start + batch_size])
            inputs = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=settings.RECOMMENDATION_MAX_LENGTH,
                return_tensors="pt",
            )
            inputs = {key: value.to(self._device) for key, value in inputs.items()}

            with torch.inference_mode():
                outputs = self.model(**inputs)

            pooled = self._mean_pool(
                outputs.last_hidden_state, inputs["attention_mask"]
            )
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

    def _normalize_text(self, value: str | None) -> str:
        if not value:
            return ""

        return re.sub(r"\s+", " ", value).strip()

    def _format_query_text(self, viewer_profile_text: str) -> str:
        model_name = settings.RECOMMENDATION_MODEL_NAME.lower()

        if "e5" in model_name and "instruct" in model_name:
            return (
                f"Instruct: {settings.RECOMMENDATION_QUERY_INSTRUCTION}\n"
                f"Query: {viewer_profile_text}"
            )

        if "e5" in model_name:
            return f"query: {viewer_profile_text}"

        return viewer_profile_text

    def _format_candidate_text(self, candidate_profile_text: str) -> str:
        model_name = settings.RECOMMENDATION_MODEL_NAME.lower()

        if "e5" in model_name and "instruct" not in model_name:
            return f"passage: {candidate_profile_text}"

        return candidate_profile_text

    def _calibrate_cosine_score(self, cosine_score: float) -> float:
        floor = settings.RECOMMENDATION_SCORE_FLOOR
        ceiling = settings.RECOMMENDATION_SCORE_CEILING

        if ceiling <= floor:
            normalized = (cosine_score + 1.0) / 2.0
            return self._clamp_score(normalized)

        normalized = (cosine_score - floor) / (ceiling - floor)
        return self._clamp_score(normalized)

    def _clamp_score(self, value: float) -> float:
        return max(0.0, min(1.0, float(value)))


model_loader = ModelLoader()
