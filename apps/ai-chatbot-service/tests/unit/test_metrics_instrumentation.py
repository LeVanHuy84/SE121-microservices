"""Unit tests for Prometheus metrics instrumentation (Task 9)."""

from __future__ import annotations

import unittest
from prometheus_client import generate_latest

from app.core.metrics import (
    record_empty_reply,
    record_token_usage,
    record_truncation,
    record_turn_latency,
)


class TestMetricsInstrumentation(unittest.TestCase):
    def test_record_empty_reply_increments_counter(self):
        record_empty_reply()
        output = generate_latest().decode("utf-8")
        self.assertIn("chatbot_llm_empty_replies_total", output)

    def test_record_truncation_records_finish_reason(self):
        record_truncation("length")
        output = generate_latest().decode("utf-8")
        self.assertIn('chatbot_llm_truncation_total{finish_reason="length"}', output)

    def test_record_token_usage_records_prompt_and_completion(self):
        record_token_usage(prompt_tokens=42, completion_tokens=18)
        output = generate_latest().decode("utf-8")
        self.assertIn('chatbot_token_usage_total{token_type="prompt"}', output)
        self.assertIn('chatbot_token_usage_total{token_type="completion"}', output)

    def test_record_turn_latency_observes_histogram(self):
        record_turn_latency(0.45, scenario="answer")
        output = generate_latest().decode("utf-8")
        self.assertIn("chatbot_turn_latency_seconds_bucket", output)
        self.assertIn('scenario="answer"', output)


if __name__ == "__main__":
    unittest.main()
