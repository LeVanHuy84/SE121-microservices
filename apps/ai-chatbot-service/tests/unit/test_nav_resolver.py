from __future__ import annotations

import json
import time
import unittest
from pathlib import Path

from app.modules.chatbot.navigation.catalog import destination_catalog
from app.modules.chatbot.navigation.resolver import NavResolver

_FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"
_EVAL_FILE = _FIXTURES_DIR / "nav_eval_vi.jsonl"


class NavCatalogTest(unittest.TestCase):
    def test_catalog_loads_destinations(self):
        self.assertGreaterEqual(len(destination_catalog), 18)
        home = destination_catalog.get("home")
        self.assertIsNotNone(home)
        self.assertEqual(home.label_vi, "Trang chủ")

    def test_admin_routes_not_in_catalog(self):
        for entry in destination_catalog.all_destinations():
            self.assertFalse(entry.id.startswith("admin"), f"Admin route in catalog: {entry.id}")
            self.assertNotIn("admin", entry.id)


class NavResolverUnitTest(unittest.TestCase):
    def setUp(self):
        self.resolver = NavResolver(destination_catalog)

    def test_command_resolves_directly_without_accents(self):
        decision = self.resolver.resolve("mo cai dat thong bao")
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "settings.notifications")

    def test_command_resolves_with_vietnamese_accents(self):
        decision = self.resolver.resolve("mở quyền riêng tư")
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "settings.privacy")

    def test_search_intent_query_extraction(self):
        decision = self.resolver.resolve("tìm nhóm yoga thiền")
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "search")
        self.assertEqual(decision.matches[0].params.get("type"), "groups")
        self.assertIn("yoga", decision.matches[0].params.get("q", ""))

    def test_search_intent_sanitizes_conversational_suffixes(self):
        decision = self.resolver.resolve("tìm cho tôi nhóm yoga nhé")
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "search")
        self.assertEqual(decision.matches[0].params.get("type"), "groups")
        self.assertEqual(decision.matches[0].params.get("q"), "yoga")

    def test_search_intent_extracts_quoted_phrases(self):
        decision = self.resolver.resolve('tìm bài viết về "Sức khỏe tinh thần" đi')
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "search")
        self.assertEqual(decision.matches[0].params.get("type"), "posts")
        self.assertEqual(decision.matches[0].params.get("q"), "Sức khỏe tinh thần")

    def test_search_intent_cleans_punctuation(self):
        decision = self.resolver.resolve("tra cứu người dùng tên Nam với?")
        self.assertEqual(decision.path, "command")
        self.assertEqual(decision.matches[0].destination_id, "search")
        self.assertEqual(decision.matches[0].params.get("type"), "users")
        self.assertEqual(decision.matches[0].params.get("q"), "Nam")

    def test_admin_keywords_rejected(self):
        decision = self.resolver.resolve("mở trang admin quản trị")
        self.assertEqual(decision.path, "none")
        self.assertEqual(len(decision.matches), 0)

    def test_feature_question_not_resolved_as_nav(self):
        decision = self.resolver.resolve("chat hiện tại có chức năng video call không?")
        self.assertEqual(decision.path, "none")

    def test_howto_intent_resolves_as_howto(self):
        decision = self.resolver.resolve("làm sao để tắt thông báo")
        self.assertEqual(decision.path, "howto")
        self.assertTrue(any(m.destination_id == "settings.notifications" for m in decision.matches))


class NavResolverBenchmarkTest(unittest.TestCase):
    def setUp(self):
        self.resolver = NavResolver(destination_catalog)

    def test_eval_set_gates(self):
        self.assertTrue(_EVAL_FILE.exists(), f"Missing eval file: {_EVAL_FILE}")

        samples = []
        with open(_EVAL_FILE, encoding="utf-8") as f:
            for line in f:
                stripped = line.strip()
                if stripped:
                    samples.append(json.loads(stripped))

        self.assertGreaterEqual(len(samples), 100, "Eval set must contain at least 100 utterances")

        nav_samples = [s for s in samples if s["expected_destination"] is not None]
        negative_samples = [s for s in samples if s["expected_destination"] is None]

        top1_hits = 0
        top3_hits = 0
        latencies = []

        for sample in nav_samples:
            utterance = sample["utterance"]
            expected_id = sample["expected_destination"]

            start = time.perf_counter()
            decision = self.resolver.resolve(utterance)
            elapsed_ms = (time.perf_counter() - start) * 1000
            latencies.append(elapsed_ms)

            match_ids = [m.destination_id for m in decision.matches]
            if match_ids and match_ids[0] == expected_id:
                top1_hits += 1
            if expected_id in match_ids[:3]:
                top3_hits += 1

        top1_acc = top1_hits / len(nav_samples)
        top3_acc = top3_hits / len(nav_samples)

        # False positives: negative samples that got a destination match
        false_positives = 0
        for sample in negative_samples:
            decision = self.resolver.resolve(sample["utterance"])
            if decision.path != "none" and decision.matches:
                false_positives += 1

        fp_rate = false_positives / len(negative_samples)

        avg_latency_ms = sum(latencies) / max(len(latencies), 1)

        print(
            f"\n[NavResolver Eval] Top-1: {top1_acc:.2%}, Top-3: {top3_acc:.2%}, "
            f"FP Rate: {fp_rate:.2%}, Avg Latency: {avg_latency_ms:.3f}ms"
        )

        self.assertGreaterEqual(top1_acc, 0.85, f"Top-1 accuracy {top1_acc:.2%} must be >= 85%")
        self.assertGreaterEqual(top3_acc, 0.95, f"Top-3 accuracy {top3_acc:.2%} must be >= 95%")
        self.assertLessEqual(fp_rate, 0.05, f"False positive rate {fp_rate:.2%} must be <= 5%")
        self.assertLess(avg_latency_ms, 5.0, f"Average latency {avg_latency_ms:.3f}ms must be < 5ms")


if __name__ == "__main__":
    unittest.main()
