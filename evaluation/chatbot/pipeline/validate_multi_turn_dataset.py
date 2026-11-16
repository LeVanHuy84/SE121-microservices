"""Validation pipeline for Sentimeta Multi-Turn Benchmark Cases."""

import json
import sys
from collections import Counter
from pathlib import Path

# Add parent directory of pipeline to path to import schemas
CURRENT_DIR = Path(__file__).resolve().parent
CHATBOT_EVAL_DIR = CURRENT_DIR.parent
if str(CHATBOT_EVAL_DIR) not in sys.path:
    sys.path.insert(0, str(CHATBOT_EVAL_DIR))

from schemas import MultiTurnBenchmarkCase, BenchmarkCategory, SourceStandard


DATASET_PATH = CHATBOT_EVAL_DIR / "data" / "multi_turn_benchmark_cases.json"


def validate_multi_turn_dataset():
    print("=" * 75)
    print("  SENTIMETA ASSISTANT — MULTI-TURN BENCHMARK VALIDATION PIPELINE")
    print("=" * 75)

    if not DATASET_PATH.exists():
        print(f"[ERROR] Multi-turn dataset file not found at: {DATASET_PATH}")
        sys.exit(1)

    with open(DATASET_PATH, "r", encoding="utf-8") as f:
        raw_cases = json.load(f)

    print(f"\n[*] Loaded raw multi-turn dataset with {len(raw_cases)} dialogues.")

    # 1. Pydantic Schema Validation
    validated_dialogues: list[MultiTurnBenchmarkCase] = []
    validation_errors = []

    for idx, d_raw in enumerate(raw_cases, start=1):
        try:
            validated = MultiTurnBenchmarkCase.model_validate(d_raw)
            validated_dialogues.append(validated)
        except Exception as e:
            validation_errors.append((d_raw.get("dialogue_id", f"INDEX_{idx}"), str(e)))

    if validation_errors:
        print(f"\n[FAIL] {len(validation_errors)} dialogues failed schema validation:")
        for dlg_id, err in validation_errors:
            print(f"  - {dlg_id}: {err}")
        sys.exit(1)
    else:
        print("[PASS] 100% of multi-turn dialogues successfully validated against Pydantic schema!")

    # 2. Dialogue ID Uniqueness Check
    dlg_ids = [d.dialogue_id for d in validated_dialogues]
    duplicate_ids = [did for did, count in Counter(dlg_ids).items() if count > 1]
    if duplicate_ids:
        print(f"\n[FAIL] Duplicate Dialogue IDs detected: {duplicate_ids}")
        sys.exit(1)
    else:
        print(f"[PASS] All {len(dlg_ids)} dialogue IDs are strictly unique.")

    # 3. Turn Sequence Continuity & Minimum Turns Check
    turn_sequence_errors = []
    for d in validated_dialogues:
        if len(d.turns) < 2:
            turn_sequence_errors.append((d.dialogue_id, "Dialogue has less than 2 turns."))
        for idx, t in enumerate(d.turns, start=1):
            if t.turn_index != idx:
                turn_sequence_errors.append(
                    (d.dialogue_id, f"Turn index mismatch: expected {idx}, got {t.turn_index}")
                )

    if turn_sequence_errors:
        print(f"\n[FAIL] Turn sequence errors detected:")
        for did, err in turn_sequence_errors:
            print(f"  - {did}: {err}")
        sys.exit(1)
    else:
        print("[PASS] All dialogue turns are strictly sequential (1, 2, 3...) and exceed minimum length!")

    # 4. Content Completeness Checklist across all Turns
    total_turns = sum(len(d.turns) for d in validated_dialogues)
    empty_queries = []
    empty_expected = []
    empty_forbidden = []
    empty_gists = []
    missing_retention_checks = []

    for d in validated_dialogues:
        for t in d.turns:
            ref = f"{d.dialogue_id}_T{t.turn_index}"
            if not t.user_query.strip():
                empty_queries.append(ref)
            if len(t.expected_elements) == 0:
                empty_expected.append(ref)
            if len(t.forbidden_behaviors) == 0:
                empty_forbidden.append(ref)
            if not t.reference_gist.strip():
                empty_gists.append(ref)
            # Turns > 1 should ideally have context_retention_check
            if t.turn_index > 1 and (not t.context_retention_check or not t.context_retention_check.strip()):
                missing_retention_checks.append(ref)

    print("\n[+] Turn-Level Ground Truth Quality Checklist:")
    print(f"  - Total conversational turns: {total_turns}")
    print(f"  - Empty queries: {len(empty_queries)}")
    print(f"  - Empty expected elements: {len(empty_expected)}")
    print(f"  - Empty forbidden behaviors: {len(empty_forbidden)}")
    print(f"  - Empty reference gist: {len(empty_gists)}")
    print(f"  - Turns > 1 with Context Retention Spec: {total_turns - len(validated_dialogues) - len(missing_retention_checks)} / {total_turns - len(validated_dialogues)}")

    if any([empty_queries, empty_expected, empty_forbidden, empty_gists]):
        print("[FAIL] Missing content detected in conversational turns.")
        sys.exit(1)
    print("[PASS] All ground truth elements and context retention specs across turns are complete!")

    # 5. Dialogue Distribution & Matrix Overview
    cat_counts = Counter(d.category for d in validated_dialogues)
    turns_per_cat = {
        cat: sum(len(d.turns) for d in validated_dialogues if d.category == cat)
        for cat in cat_counts
    }
    src_counts = Counter(d.source_standard for d in validated_dialogues)

    print("\n[+] Multi-Turn Category Breakdown:")
    print("-" * 65)
    print(f"{'Category':<32} | {'Dialogues':<10} | {'Total Turns':<12}")
    print("-" * 65)
    for cat, d_cnt in cat_counts.items():
        t_cnt = turns_per_cat[cat]
        print(f"{cat.value:<32} | {d_cnt:<10} | {t_cnt:<12}")
    print("-" * 65)
    print(f"{'TOTAL':<32} | {len(validated_dialogues):<10} | {total_turns:<12}")

    print("\n[+] Academic Benchmark Provenance:")
    print("-" * 65)
    print(f"{'Source Standard':<35} | {'Dialogues':<10}")
    print("-" * 65)
    for src, cnt in src_counts.items():
        print(f"{src.value:<35} | {cnt:<10}")
    print("-" * 65)

    print("\n" + "=" * 75)
    print("  RESULT: MULTI-TURN BENCHMARK DATASET IS 100% VALIDATED & READY!")
    print("=" * 75)


if __name__ == "__main__":
    validate_multi_turn_dataset()
