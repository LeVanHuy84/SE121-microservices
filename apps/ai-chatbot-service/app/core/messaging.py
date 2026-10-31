from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("uvicorn.error")

_kafka_producer: Any | None = None
_outbox_repo: Any | None = None
_emotion_aggregate_repo: Any | None = None


def set_kafka_producer(producer: Any) -> None:
    global _kafka_producer
    _kafka_producer = producer


def get_kafka_producer() -> Any | None:
    if _kafka_producer is not None:
        return _kafka_producer
    import sys

    if "app.modules.analysis.lifespan" in sys.modules:
        mod = sys.modules["app.modules.analysis.lifespan"]
        return getattr(mod, "kafka_producer", None)
    return None


def set_outbox_repo(repo: Any) -> None:
    global _outbox_repo
    _outbox_repo = repo


def get_outbox_repo() -> Any | None:
    if _outbox_repo is not None:
        return _outbox_repo
    import sys

    if "app.modules.analysis.lifespan" in sys.modules:
        mod = sys.modules["app.modules.analysis.lifespan"]
        return getattr(mod, "outbox_repo", None)
    return None


def set_emotion_aggregate_repo(repo: Any) -> None:
    global _emotion_aggregate_repo
    _emotion_aggregate_repo = repo


def get_emotion_aggregate_repo() -> Any | None:
    if _emotion_aggregate_repo is not None:
        return _emotion_aggregate_repo
    import sys

    if "app.modules.analysis.lifespan" in sys.modules:
        mod = sys.modules["app.modules.analysis.lifespan"]
        return getattr(mod, "emotion_aggregate_repo", None)
    return None

