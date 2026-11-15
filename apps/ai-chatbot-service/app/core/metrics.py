"""Prometheus metrics instrumentation for AI Chatbot Service."""

from __future__ import annotations

import logging

logger = logging.getLogger("uvicorn.error")

try:
    from prometheus_client import Counter, Histogram

    CHATBOT_LLM_EMPTY_REPLIES_TOTAL = Counter(
        "chatbot_llm_empty_replies_total",
        "Total occurrences of empty LLM replies caught by guard and fallen back",
    )

    CHATBOT_LLM_TRUNCATION_TOTAL = Counter(
        "chatbot_llm_truncation_total",
        "Total truncated LLM outputs repaired",
        ["finish_reason"],
    )

    CHATBOT_TURN_LATENCY_SECONDS = Histogram(
        "chatbot_turn_latency_seconds",
        "End-to-end chatbot turn latency in seconds",
        ["scenario"],
        buckets=(0.1, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0, 10.0),
    )

    CHATBOT_TOKEN_USAGE_TOTAL = Counter(
        "chatbot_token_usage_total",
        "Total token usage from LLM completions",
        ["token_type"],  # "prompt" or "completion"
    )

    _METRICS_ENABLED = True
except Exception as e:
    logger.warning("Prometheus client not available for chatbot metrics: %s", e)
    _METRICS_ENABLED = False


def record_empty_reply() -> None:
    if _METRICS_ENABLED:
        try:
            CHATBOT_LLM_EMPTY_REPLIES_TOTAL.inc()
        except Exception:
            pass


def record_truncation(finish_reason: str = "length") -> None:
    if _METRICS_ENABLED:
        try:
            CHATBOT_LLM_TRUNCATION_TOTAL.labels(
                finish_reason=str(finish_reason or "length")
            ).inc()
        except Exception:
            pass


def record_turn_latency(seconds: float, scenario: str = "default") -> None:
    if _METRICS_ENABLED:
        try:
            CHATBOT_TURN_LATENCY_SECONDS.labels(
                scenario=str(scenario or "default")
            ).observe(max(seconds, 0.0))
        except Exception:
            pass


def record_token_usage(prompt_tokens: int = 0, completion_tokens: int = 0) -> None:
    if _METRICS_ENABLED:
        try:
            if prompt_tokens > 0:
                CHATBOT_TOKEN_USAGE_TOTAL.labels(token_type="prompt").inc(prompt_tokens)
            if completion_tokens > 0:
                CHATBOT_TOKEN_USAGE_TOTAL.labels(token_type="completion").inc(
                    completion_tokens
                )
        except Exception:
            pass
