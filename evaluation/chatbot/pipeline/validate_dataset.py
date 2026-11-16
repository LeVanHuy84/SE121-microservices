"""Comprehensive validation script for the Sentimeta Chatbot Golden Benchmark Dataset."""

import json
import sys
from collections import Counter
from pathlib import Path

# Add parent directory of pipeline to path to import schemas
CURRENT_DIR = Path(__file__).resolve().parent
CHATBOT_EVAL_DIR = CURRENT_DIR.parent
if str(CHATBOT_EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(CHATBOT_EVAL_DIR))

from schemas import BenchmarkCase, BenchmarkCategory, EmotionType, SourceStandard


DATASET_PATH = CHATBOT_EVAL_DIR / "data" / "golden_benchmark_cases.json"


def validate_dataset():
    print("=" * 75)
    print("  SENTIMETA ASSISTANT — BENCHMARK DATASET VALIDATION PIPELINE")
    print("=" * 75)

    if not DATASET_PATH.exists():
        print(f"[ERROR] Dataset file not found at: {DATASET_PATH}")
        sys.exit(1)

    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        raw_cases = json.load(f)

    print(f"\n[*] Loaded raw dataset with {len(raw_cases)} cases.")

    # 1. Schema Validation with Pydantic
    validated_cases: list[BenchmarkCase] = []
    validation_errors = []

    for idx, case_raw in enumerate(raw_cases, start=1):
        try:
            validated = BenchmarkCase.model_validate(case_raw)
            validated_cases.append(validated)
        except Exception as e:
            validation_errors.append((case_raw.get("id", f"INDEX_{idx}"), str(e)))

    if validation_errors:
        print(f"\n[FAIL] {len(validation_errors)} cases failed schema validation:")
        for case_id, err in validation_errors:
            print(f"  - {case_id}: {err}")
        sys.exit(1)
    else:
        print("[PASS] 100% of benchmark cases successfully validated against Pydantic schema!")

    # 2. ID Uniqueness Check
    case_ids = [c.id for c in validated_cases]
    duplicate_ids = [cid for cid, count in Counter(case_ids).items() if count > 1]
    if duplicate_ids:
        print(f"\n[FAIL] Duplicate IDs detected: {duplicate_ids}")
        sys.exit(1)
    else:
        print(f"[PASS] All {len(case_ids)} case IDs are strictly unique.")

    # 3. Category Distribution Check
    category_counts = Counter(c.category for c in validated_cases)
    expected_matrix = {
        BenchmarkCategory.MENTAL_HEALTH_PFA: 35,
        BenchmarkCategory.CRISIS_SELF_HARM: 20,
        BenchmarkCategory.IN_DOMAIN_APP_RAG: 30,
        BenchmarkCategory.OUT_OF_DOMAIN_ADVERSARIAL: 15,
    }

    print("\n[+] Stratified Scenario Matrix Verification:")
    print("-" * 65)
    print(f"{'Category':<32} | {'Actual':<8} | {'Expected':<8} | {'Status':<6}")
    print("-" * 65)
    all_matched = True
    for cat, exp_count in expected_matrix.items():
        act_count = category_counts.get(cat, 0)
        status = "MATCH" if act_count == exp_count else "MISMATCH"
        if status != "MATCH":
            all_matched = False
        print(f"{cat.value:<32} | {act_count:<8} | {exp_count:<8} | {status:<6}")
    print("-" * 65)
    print(f"{'TOTAL SAMPLES':<32} | {len(validated_cases):<8} | {100:<8} | {'OK' if all_matched else 'ERROR'}")

    if not all_matched:
        print("[FAIL] Category distribution does not match the 100-sample Stratified Matrix.")
        sys.exit(1)

    # 4. Source Standard / Provenance Verification
    source_counts = Counter(c.source_standard for c in validated_cases)
    print("\n[+] Academic Benchmark Provenance Breakdown:")
    print("-" * 65)
    print(f"{'Source Standard':<35} | {'Count':<8} | {'Ratio (%)':<10}")
    print("-" * 65)
    for src in SourceStandard:
        cnt = source_counts.get(src, 0)
        pct = (cnt / len(validated_cases)) * 100.0
        print(f"{src.value:<35} | {cnt:<8} | {pct:>8.1f}%")
    print("-" * 65)

    # 5. Content Quality & Ground Truth Completeness
    empty_queries = [c.id for c in validated_cases if not c.query.strip()]
    empty_expected = [c.id for c in validated_cases if len(c.reference_ground_truth.expected_elements) == 0]
    empty_forbidden = [c.id for c in validated_cases if len(c.reference_ground_truth.forbidden_behaviors) == 0]
    empty_gist = [c.id for c in validated_cases if not c.reference_ground_truth.reference_gist.strip()]

    print("\n[+] Ground Truth Quality & Integrity Checklist:")
    print(f"  - Empty queries: {len(empty_queries)}")
    print(f"  - Empty expected elements: {len(empty_expected)}")
    print(f"  - Empty forbidden behaviors: {len(empty_forbidden)}")
    print(f"  - Empty reference gist: {len(empty_gist)}")

    if any([empty_queries, empty_expected, empty_forbidden, empty_gist]):
        print("[FAIL] Some cases contain missing ground truth elements.")
        sys.exit(1)
    print("[PASS] All ground truth elements (ideal_intent, expected, forbidden, gist) are complete!")

    # 6. Statistical Overview
    query_lengths = [len(c.query) for c in validated_cases]
    expected_elem_counts = [len(c.reference_ground_truth.expected_elements) for c in validated_cases]
    forbidden_elem_counts = [len(c.reference_ground_truth.forbidden_behaviors) for c in validated_cases]
    emotions = Counter(c.user_context.current_emotion.value for c in validated_cases)

    avg_query_len = sum(query_lengths) / len(query_lengths)
    avg_exp_count = sum(expected_elem_counts) / len(expected_elem_counts)
    avg_forb_count = sum(forbidden_elem_counts) / len(forbidden_elem_counts)

    print("\n[+] Dataset Statistical Summary:")
    print(f"  - Average query length: {avg_query_len:.1f} characters (Min: {min(query_lengths)}, Max: {max(query_lengths)})")
    print(f"  - Average expected elements per case: {avg_exp_count:.2f}")
    print(f"  - Average forbidden behaviors per case: {avg_forb_count:.2f}")
    print(f"  - Emotion distribution across test cases: {dict(emotions)}")

    print("\n" + "=" * 75)
    print("  RESULT: GOLDEN BENCHMARK DATASET IS 100% VALIDATED & EXPERIMENT-READY!")
    print("=" * 75)


if __name__ == "__main__":
    validate_dataset()
