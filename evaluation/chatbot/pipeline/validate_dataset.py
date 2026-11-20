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

from schemas import BenchmarkCase, BenchmarkCategory, SourceStandard  # noqa: E402


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
    empty_intents = [c.id for c in validated_cases if not c.reference_ground_truth.ideal_intent.strip()]
    empty_forbidden = [c.id for c in validated_cases if len(c.reference_ground_truth.forbidden_behaviors) == 0]

    print("\n[+] Ground Truth Quality & Safety Boundaries Checklist:")
    print(f"  - Empty queries: {len(empty_queries)}")
    print(f"  - Empty ideal intents: {len(empty_intents)}")
    print(f"  - Empty forbidden behaviors: {len(empty_forbidden)}")

    if any([empty_queries, empty_intents, empty_forbidden]):
        print("[FAIL] Some cases contain missing queries, intents, or safety guardrails.")
        sys.exit(1)
    print("[PASS] All ground truth elements (ideal_intent, forbidden_behaviors) are complete & aligned with rubric-based eval!")

    # 6. Statistical Overview
    query_lengths = [len(c.query) for c in validated_cases]
    forbidden_elem_counts = [len(c.reference_ground_truth.forbidden_behaviors) for c in validated_cases]
    emotions = Counter(c.user_context.current_emotion.value for c in validated_cases)

    avg_query_len = sum(query_lengths) / len(query_lengths)
    avg_forb_count = sum(forbidden_elem_counts) / len(forbidden_elem_counts)

    print("\n[+] Dataset Statistical Summary:")
    print(f"  - Average query length: {avg_query_len:.1f} characters (Min: {min(query_lengths)}, Max: {max(query_lengths)})")
    print(f"  - Average forbidden behaviors per case: {avg_forb_count:.2f}")
    print(f"  - Emotion distribution across test cases: {dict(emotions)}")

    print("\n" + "=" * 75)
    print("  RESULT: GOLDEN BENCHMARK DATASET IS 100% VALIDATED & EXPERIMENT-READY!")
    print("=" * 75)


if __name__ == "__main__":
    validate_dataset()
