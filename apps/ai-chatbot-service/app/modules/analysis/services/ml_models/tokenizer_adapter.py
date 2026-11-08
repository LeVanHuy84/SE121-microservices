# app/modules/analysis/services/ml_models/tokenizer_adapter.py
"""
Safe Tokenizer Adapter
Provides offline MockTokenizer during UNIT_TEST_MODE or sandbox environments
to prevent external HTTP requests to Hugging Face Hub (huggingface.co).
"""

import logging
import os
from typing import Any, Dict, List, Union

import numpy as np

from app.core.settings import settings

logger = logging.getLogger(__name__)


class MockTokenizer:
    """Mock tokenizer returning deterministic numpy ndarrays for CPU test inference."""

    def __init__(self, model_name: str = "mock-phobert-tokenizer"):
        self.model_name = model_name
        self.model_max_length = 256
        self.pad_token_id = 1
        self.eos_token_id = 2
        self.bos_token_id = 0
        self.vocab_size = 64000
        self.is_fast = True

    def __call__(
        self,
        texts: Union[str, List[str]],
        return_tensors: str = "np",
        truncation: bool = True,
        max_length: int = 128,
        padding: bool = True,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        if isinstance(texts, str):
            batch_size = 1
        else:
            batch_size = len(texts) if texts else 1

        seq_len = min(16, max_length) if max_length else 16
        input_ids = np.ones((batch_size, seq_len), dtype=np.int64)
        attention_mask = np.ones((batch_size, seq_len), dtype=np.int64)

        if return_tensors == "pt":
            try:
                import torch

                return {
                    "input_ids": torch.from_numpy(input_ids),
                    "attention_mask": torch.from_numpy(attention_mask),
                }
            except ImportError:
                pass

        return {
            "input_ids": input_ids,
            "attention_mask": attention_mask,
        }

    def encode(self, text: str, **kwargs: Any) -> List[int]:
        return [0, 1, 2]

    def decode(self, token_ids: List[int], **kwargs: Any) -> str:
        return "mock text"


def safe_load_tokenizer(tokenizer_source: str) -> Any:
    """
    Safely load tokenizer.
    If UNIT_TEST_MODE or MOCK_EXTERNAL_MODELS is enabled, returns MockTokenizer.
    If internet is unreachable, gracefully catches exception and returns MockTokenizer.
    """
    is_test_mode = (
        os.getenv("UNIT_TEST_MODE", "false").lower() == "true"
        or os.getenv("MOCK_EXTERNAL_MODELS", "false").lower() == "true"
        or getattr(settings, "UNIT_TEST_MODE", False)
        or getattr(settings, "MOCK_EXTERNAL_MODELS", False)
    )

    if is_test_mode:
        logger.info(
            "[SafeTokenizer] Unit test mode active. Using MockTokenizer for %s",
            tokenizer_source,
        )
        return MockTokenizer(tokenizer_source)

    try:
        from transformers import AutoTokenizer

        return AutoTokenizer.from_pretrained(tokenizer_source)
    except Exception as exc:
        logger.warning(
            "[SafeTokenizer] Failed to fetch AutoTokenizer from %s (%s). Falling back to MockTokenizer.",
            tokenizer_source,
            exc,
        )
        return MockTokenizer(tokenizer_source)

