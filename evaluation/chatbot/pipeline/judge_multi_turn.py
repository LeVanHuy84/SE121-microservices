"""Script to evaluate Multi-Turn Chatbot Dialogues using Gemini LLM-as-a-Judge.

Reads `evaluation/chatbot/results/multi_turn_responses.json`,
calls Google Gemini to evaluate each dialogue according to the multi-turn rubrics
(Context Consistency, Retention, Faithfulness, Relevance, Empathy, Clinical Safety),
and incrementally saves judgments to `evaluation/chatbot/results/multi_turn_judgments.json`.
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from gemini_client import GeminiJudgeClient
from judge_prompts import MULTI_TURN_SYSTEM_INSTRUCTION, build_multi_turn_judge_prompt

# Paths
CURRENT_DIR = Path(__file__).resolve().parent
CHATBOT_EVAL_DIR = CURRENT_DIR.parent
DEFAULT_RESPONSES_FILE = CHATBOT_EVAL_DIR / "results" / "multi_turn_responses.json"
DEFAULT_OUTPUT_FILE = CHATBOT_EVAL_DIR / "results" / "multi_turn_judgments.json"


def parse_args():
    parser = argparse.ArgumentParser(description="Evaluate Multi-Turn Chatbot Dialogues with Gemini Judge")
    parser.add_argument(
        "--input",
        type=str,
        default=str(DEFAULT_RESPONSES_FILE),
        help="Path to multi-turn chatbot responses JSON file",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(DEFAULT_OUTPUT_FILE),
        help="Path to output multi-turn judgments JSON file",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of dialogues to judge (e.g. 1 for quick test, 0 = all)",
    )
    parser.add_argument(
        "--category",
        type=str,
        default="",
        help="Filter by category (mental_health_pfa, crisis_self_harm, in_domain_app_rag, out_of_domain_adversarial)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=1.0,
        help="Delay in seconds between Gemini API calls",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing judgments and re-judge all dialogues from scratch",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="",
        help="Override Gemini model name (default reads from evaluation/.env)",
    )
    return parser.parse_args()


def atomic_save_json(output_path: Path, data: List[Dict[str, Any]]):
    """Safely saves JSON data using a temporary file and atomic replace."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    for _ in range(3):
        try:
            os.replace(tmp_path, output_path)
            return
        except OSError:
            time.sleep(0.05)
    os.replace(tmp_path, output_path)


def load_existing_judgments(output_path: Path) -> Dict[str, Dict[str, Any]]:
    """Loads existing judgments if present and valid."""
    if not output_path.exists() or output_path.stat().st_size == 0:
        return {}
    try:
        with open(output_path, "r", encoding="utf-8") as f:
            records = json.load(f)
            if isinstance(records, list):
                return {r["dialogue_id"]: r for r in records if "dialogue_id" in r}
    except Exception as exc:
        print(f"[!] Warning: Could not read existing multi-turn judgments ({exc}). Starting fresh.")
    return {}


def main():
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    print("=" * 75)
    print("  SENTIMETA ASSISTANT — GEMINI LLM-AS-A-JUDGE (MULTI-TURN EVALUATION)")
    print("=" * 75)
    print(f"[*] Input File   : {input_path.resolve()}")
    print(f"[*] Output File  : {output_path.resolve()}")

    if not input_path.exists():
        print(f"[ERROR] Input responses file not found: {input_path}")
        print("Please run `python evaluation/chatbot/pipeline/run_multi_turn_benchmark.py` first!")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        all_dialogues = json.load(f)

    if not all_dialogues:
        print("[!] Input multi-turn responses file is currently empty.")
        print("Tip: Run `python evaluation/chatbot/pipeline/run_multi_turn_benchmark.py` first.")
        sys.exit(0)

    # Initialize Gemini client
    try:
        client = GeminiJudgeClient(model_name=args.model if args.model else None)
        print(f"[*] Gemini Model : {client.model_name}")
    except Exception as exc:
        print(f"[ERROR] Failed to initialize Gemini client: {exc}")
        sys.exit(1)

    filtered_dialogues = all_dialogues
    if args.category:
        filtered_dialogues = [d for d in filtered_dialogues if d.get("category") == args.category]
        print(f"[*] Filtered by category '{args.category}': {len(filtered_dialogues)} dialogues")

    if args.limit > 0:
        filtered_dialogues = filtered_dialogues[: args.limit]
        print(f"[*] Limited to first {args.limit} dialogue(s)")

    total_dialogues = len(filtered_dialogues)
    all_dlg_order = {d["dialogue_id"]: i for i, d in enumerate(all_dialogues)}

    stored_judgments: Dict[str, Dict[str, Any]] = {}
    if not args.no_resume:
        stored_judgments = load_existing_judgments(output_path)
        if stored_judgments:
            print(f"[*] Found checkpoint with {len(stored_judgments)} previously judged dialogues.")

    print(f"[*] Executing evaluation across {total_dialogues} dialogues...\n")

    skipped_count = 0
    judged_count = 0
    scores_acc = {
        "context_consistency": 0.0,
        "faithfulness": 0.0,
        "relevance": 0.0,
        "empathy": 0.0,
        "clinical_safety": 0.0,
    }
    verdicts_count = {"PASS": 0, "FAIL": 0}

    try:
        for idx, dlg in enumerate(filtered_dialogues, start=1):
            dlg_id = dlg["dialogue_id"]
            cat = dlg.get("category", "")
            title = dlg.get("title", "Untitled Dialogue")
            turns_count = len(dlg.get("turns", []))

            # Check if already judged (only skip if judgment is valid and complete)
            if not args.no_resume and dlg_id in stored_judgments:
                prev_j = stored_judgments[dlg_id]
                is_valid_j = (
                    isinstance(prev_j, dict)
                    and "judgment" in prev_j
                    and isinstance(prev_j["judgment"], dict)
                    and "scores" in prev_j["judgment"]
                    and "overall_verdict" in prev_j["judgment"]
                )
                if is_valid_j:
                    skipped_count += 1
                    v = prev_j.get("judgment", {}).get("overall_verdict", "UNKNOWN")
                    print(f"[{idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}): [RESUMED / SKIPPED - Verdict: {v}]")
                    continue

            print(f"[{idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}): \"{title}\" [{turns_count} turns] ... ", end="", flush=True)

            prompt = build_multi_turn_judge_prompt(dlg)

            try:
                judgment_data = client.generate_json_judgment(
                    prompt=prompt,
                    system_instruction=MULTI_TURN_SYSTEM_INSTRUCTION,
                )
                judged_count += 1
                scores = judgment_data.get("scores", {})
                verdict = judgment_data.get("overall_verdict", "FAIL")
                ov_score = judgment_data.get("overall_score", 0.0)
                ret_verdict = judgment_data.get("context_retention_verdict", "N/A")
                latency = judgment_data.get("_meta", {}).get("latency_ms", 0.0)

                verdicts_count[verdict] = verdicts_count.get(verdict, 0) + 1
                for k in scores_acc:
                    scores_acc[k] += float(scores.get(k, 0))

                print(f"OK [{verdict} | Ret:{ret_verdict}] Score: {ov_score:.2f} (Ctx:{scores.get('context_consistency')}, F:{scores.get('faithfulness')}, R:{scores.get('relevance')}, E:{scores.get('empathy')}, S:{scores.get('clinical_safety')}) ({latency:.0f}ms)")

                record = {
                    "dialogue_id": dlg_id,
                    "category": cat,
                    "title": title,
                    "subtopic": dlg.get("subtopic"),
                    "source_standard": dlg.get("source_standard"),
                    "turns_count": turns_count,
                    "judgment": judgment_data,
                    "judged_at": datetime.utcnow().isoformat() + "Z",
                }
                stored_judgments[dlg_id] = record

                # Atomic save
                ordered_list = sorted(
                    stored_judgments.values(),
                    key=lambda r: all_dlg_order.get(r.get("dialogue_id"), 9999),
                )
                atomic_save_json(output_path, ordered_list)

                if args.delay > 0 and idx < total_dialogues:
                    time.sleep(args.delay)

            except Exception as j_exc:
                print(f"FAILED [Judge Error: {j_exc}]")

    except KeyboardInterrupt:
        print("\n\n[!] JUDGMENT PAUSED BY USER (Ctrl+C).")
        print(f"[*] Safely preserved {len(stored_judgments)} judgments in: {output_path.resolve()}")
        sys.exit(0)

    # Final save
    ordered_list = sorted(
        stored_judgments.values(),
        key=lambda r: all_dlg_order.get(r.get("dialogue_id"), 9999),
    )
    atomic_save_json(output_path, ordered_list)

    # Final summary statistics computed across all valid records
    all_scores = {
        "context_consistency": 0.0,
        "faithfulness": 0.0,
        "relevance": 0.0,
        "empathy": 0.0,
        "clinical_safety": 0.0,
    }
    all_verdicts: Dict[str, int] = {}
    valid_count = 0
    for r in ordered_list:
        j = r.get("judgment", {})
        sc = j.get("scores", {})
        v = j.get("overall_verdict")
        if v:
            all_verdicts[v] = all_verdicts.get(v, 0) + 1
        if sc:
            valid_count += 1
            for k in all_scores:
                all_scores[k] += float(sc.get(k, 0))

    print("\n" + "=" * 75)
    print("  MULTI-TURN EVALUATION COMPLETED — SUMMARY STATISTICS")
    print("=" * 75)
    print(f"  - Target Dialogues      : {total_dialogues}")
    print(f"  - Newly Judged          : {judged_count}")
    print(f"  - Resumed / Skipped     : {skipped_count}")
    print(f"  - Total Saved in JSON   : {len(ordered_list)}")
    if valid_count > 0:
        print(f"  - Avg Context Consistency: {all_scores['context_consistency']/valid_count:.2f} / 5.0")
        print(f"  - Average Faithfulness   : {all_scores['faithfulness']/valid_count:.2f} / 5.0")
        print(f"  - Average Relevance      : {all_scores['relevance']/valid_count:.2f} / 5.0")
        print(f"  - Average Empathy        : {all_scores['empathy']/valid_count:.2f} / 5.0")
        print(f"  - Average Clinical Safety: {all_scores['clinical_safety']/valid_count:.2f} / 5.0")
        pass_count = all_verdicts.get("PASS", 0)
        print(f"  - Verdicts Breakdown     : {all_verdicts} (Pass Rate: {(pass_count/valid_count*100):.1f}%)")
    print(f"  - Saved Output File      : {output_path.resolve()}")
    print("=" * 75)
    print("[+] Multi-turn judgments are ready for analysis and Human-in-the-Loop review!")


if __name__ == "__main__":
    main()
