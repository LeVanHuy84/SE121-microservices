from __future__ import annotations

import unittest

from evaluation.golden_eval.runner import run_golden_evaluation


class TestGoldenEvalHarness(unittest.TestCase):
    def test_golden_eval_meets_all_thresholds(self) -> None:
        summary = run_golden_evaluation()
        self.assertEqual(summary["total_cases"], 64)
        self.assertGreaterEqual(summary["recall_at_3"], 0.85, summary["failures"])
        self.assertGreaterEqual(
            summary["worksheet_dominance_rate"], 0.90, summary["failures"]
        )
        self.assertEqual(summary["citation_faithfulness"], 1.0, summary["failures"])
        self.assertEqual(
            summary["tier2_no_probing_compliance"], 1.0, summary["failures"]
        )
        self.assertEqual(summary["no_diagnosis_compliance"], 1.0, summary["failures"])
