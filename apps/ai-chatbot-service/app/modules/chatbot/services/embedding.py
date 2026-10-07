from __future__ import annotations

import logging
from collections import OrderedDict
from pathlib import Path
from typing import Sequence

import numpy as np
import onnxruntime as ort
from transformers import AutoTokenizer

from app.core.config import settings
from app.modules.analysis.services.ml_models.model_resolver import resolve_onnx_model
from app.utils.text_normalizer import normalize_text

logger = logging.getLogger("uvicorn.error")


class EmbeddingService:
    def __init__(self):
        self._tokenizer = None
        self._session: ort.InferenceSession | None = None
        self._query_cache: OrderedDict[str, list[float]] = OrderedDict()
        self._query_cache_size = settings.EMBEDDING_QUERY_CACHE_SIZE
        self.model_name = settings.EMBEDDING_MODEL_NAME
        self.precision = getattr(settings, "EMBEDDING_MODEL_PRECISION", "int8").lower()
        self.onnx_model_path: str | None = None
        self.tokenizer_source: str | None = None

    def encode_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._encode(texts, prefix="passage")

    def encode_query(self, text: str) -> list[float]:
        normalized = self._normalize_input(text)
        if not normalized:
            return []

        cached = self._query_cache.get(normalized)
        if cached is not None:
            self._query_cache.move_to_end(normalized)
            return cached

        embeddings = self._encode([normalized], prefix="query")
        result = embeddings[0] if embeddings else []
        if result:
            self._query_cache[normalized] = result
            self._query_cache.move_to_end(normalized)
            while len(self._query_cache) > self._query_cache_size:
                self._query_cache.popitem(last=False)
        return result

    def _encode(self, texts: Sequence[str], prefix: str) -> list[list[float]]:
        normalized = [
            self._format_text(self._normalize_input(text), prefix)
            for text in texts
            if self._normalize_input(text)
        ]
        if not normalized:
            return []

        tokenizer, session = self._load()
        embeddings: list[list[float]] = []

        for start in range(0, len(normalized), settings.EMBEDDING_BATCH_SIZE):
            batch = normalized[start : start + settings.EMBEDDING_BATCH_SIZE]
            encoded = tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=settings.EMBEDDING_MAX_LENGTH,
                return_tensors="np",
            )

            input_feed = {}
            for inp in session.get_inputs():
                name = inp.name
                if name in encoded:
                    val = encoded[name]
                    if inp.type == "tensor(int64)" and val.dtype != np.int64:
                        val = val.astype(np.int64)
                    elif inp.type == "tensor(int32)" and val.dtype != np.int32:
                        val = val.astype(np.int32)
                    input_feed[name] = val
                elif name == "token_type_ids":
                    input_feed[name] = np.zeros_like(
                        encoded["input_ids"], dtype=np.int64
                    )

            outputs = session.run(None, input_feed)
            last_hidden_state = outputs[0]

            pooled = self._average_pool(
                last_hidden_state,
                encoded["attention_mask"],
            )
            normalized_vecs = self._normalize_l2(pooled)
            embeddings.extend(
                [[float(value) for value in row] for row in normalized_vecs.tolist()]
            )

        return embeddings

    def _load(self) -> tuple[AutoTokenizer, ort.InferenceSession]:
        if self._tokenizer is None or self._session is None:
            candidate_dirs = [
                Path("evaluation/embedding/weights").resolve(),
                Path("evaluation/weights").resolve(),
                Path("../evaluation/weights").resolve(),
                Path("../../evaluation/weights").resolve(),
            ]
            self.onnx_model_path, self.tokenizer_source = resolve_onnx_model(
                model_path_or_repo=self.model_name,
                explicit_onnx_path=getattr(settings, "EMBEDDING_ONNX_PATH", ""),
                precision=self.precision,
                model_type_hint="embedding",
                candidate_local_dirs=candidate_dirs,
            )

            logger.info(
                "[EmbeddingService] Loading ONNX (%s) embedding model from: %s (Tokenizer: %s)",
                self.precision,
                self.onnx_model_path,
                self.tokenizer_source,
            )
            self._tokenizer = AutoTokenizer.from_pretrained(self.tokenizer_source)

            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            opts.enable_cpu_mem_arena = False
            opts.add_session_config_entry("session.intra_op.allow_spinning", "0")

            self._session = ort.InferenceSession(
                self.onnx_model_path, opts, providers=["CPUExecutionProvider"]
            )
            logger.info(
                "[EmbeddingService] ✓ ONNX (%s) Embedding model loaded successfully on CPU",
                self.precision,
            )

        return self._tokenizer, self._session

    def _average_pool(
        self,
        last_hidden_state: np.ndarray,
        attention_mask: np.ndarray,
    ) -> np.ndarray:
        mask = np.expand_dims(attention_mask, axis=-1).astype(np.float32)
        masked_embeddings = last_hidden_state * mask
        summed = np.sum(masked_embeddings, axis=1)
        counts = np.clip(np.sum(mask, axis=1), a_min=1e-9, a_max=None)
        return summed / counts

    def _normalize_l2(self, vectors: np.ndarray) -> np.ndarray:
        norms = np.linalg.norm(vectors, ord=2, axis=1, keepdims=True)
        norms = np.clip(norms, a_min=1e-12, a_max=None)
        return vectors / norms

    def _format_text(self, text: str, prefix: str) -> str:
        model_name = self.model_name.lower()
        if "e5" in model_name and not text.startswith(("query: ", "passage: ")):
            return f"{prefix}: {text}"
        return text

    def _normalize_input(self, text: object) -> str:
        return normalize_text(text)


embedding_service = EmbeddingService()
