"""Script to execute the Single-Turn Benchmark against the Sentimeta Chatbot Service.

Captures actual chatbot responses, latencies, model details, and retrieved contexts.
Includes Checkpoint & Resume:
  - Real-time incremental saving after EVERY single query (no loss on crash/interrupt).
  - Auto-resumes from existing results (skips succeeded cases, auto-retries fallback & errors).
  - Preserves previously saved records across partial/filtered runs.
  - Auto-loads INTERNAL_SERVICE_KEY from evaluation/.env.
  - Safe atomic file writes to prevent JSON corruption on sudden aborts.
Results are saved to `evaluation/chatbot/results/single_turn_responses.json`.
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Paths
CURRENT_DIR = Path(__file__).resolve().parent
CHATBOT_EVAL_DIR = CURRENT_DIR.parent
EVAL_DIR = CHATBOT_EVAL_DIR.parent
DATASET_FILE = CHATBOT_EVAL_DIR / "data" / "golden_benchmark_cases.json"
DEFAULT_OUTPUT_FILE = CHATBOT_EVAL_DIR / "results" / "single_turn_responses.json"

# Load config from evaluation/.env
load_dotenv(EVAL_DIR / ".env")
load_dotenv()

RESOLVED_INTERNAL_KEY = os.getenv("INTERNAL_SERVICE_KEY", "")


def parse_args():
    parser = argparse.ArgumentParser(description="Execute Single-Turn Chatbot Benchmark with Checkpoint & Resume")
    parser.add_argument(
        "--endpoint",
        type=str,
        default=os.getenv("CHATBOT_API_ENDPOINT", "http://localhost:4006/assistant/respond"),
        help="FastAPI Assistant respond endpoint",
    )
    parser.add_argument(
        "--key",
        type=str,
        default=RESOLVED_INTERNAL_KEY,
        help="Internal service authentication key (sent as header 'x-internal-key')",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=str(DEFAULT_OUTPUT_FILE),
        help="Path to output results file",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of cases to run (0 = run all cases)",
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
        default=0.2,
        help="Delay in seconds between requests (increase if hitting Groq rate limits)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=35.0,
        help="HTTP request timeout in seconds",
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=3,
        help="Max retries on 429 rate limit or network error",
    )
    parser.add_argument(
        "--no-resume",
        action="store_true",
        help="Ignore existing checkpoint and re-run all cases from scratch",
    )
    return parser.parse_args()


def atomic_save_json(output_path: Path, data: List[Dict[str, Any]]):
    """Safely saves JSON data by writing to a temporary file first then replacing."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, output_path)


def load_existing_results(output_path: Path) -> Dict[str, Dict[str, Any]]:
    """Loads existing results from file if present and valid."""
    if not output_path.exists():
        return {}
    if output_path.stat().st_size == 0:
        return {}
    try:
        with open(output_path, "r", encoding="utf-8") as f:
            records = json.load(f)
            if isinstance(records, list):
                return {r["case_id"]: r for r in records if "case_id" in r}
    except Exception as exc:
        print(f"[!] Warning: Could not read existing output file ({exc}). Starting fresh.")
    return {}


def call_chatbot_api(
    client: httpx.Client,
    endpoint: str,
    headers: Dict[str, str],
    case: Dict[str, Any],
    session_user_id: str,
    timeout: float,
    max_retries: int = 3,
) -> Dict[str, Any]:
    """Calls the chatbot API with exponential backoff on 429 and transient errors."""
    conv_id = f"eval_single_{case['id']}_{uuid.uuid4().hex[:6]}"
    payload = {
        "userId": session_user_id,
        "conversationId": conv_id,
        "message": case["query"],
        "clientMessageId": f"eval-msg-{case['id']}",
        "contexts": [],
    }
    call_headers = {
        **headers,
        "x-user-id": session_user_id,
    }

    last_error_text = ""
    for attempt in range(1, max_retries + 1):
        start_time = time.perf_counter()
        try:
            response = client.post(
                endpoint,
                headers=call_headers,
                json=payload,
                timeout=timeout,
            )
            latency_ms = (time.perf_counter() - start_time) * 1000

            if response.status_code == 200:
                res_data = response.json()
                data = res_data.get("data", {})
                if "latencyMs" not in data or data["latencyMs"] is None:
                    data["latencyMs"] = latency_ms
                return data

            if response.status_code == 403:
                return {
                    "type": "error",
                    "reply": f"[HTTP 403 Forbidden] Invalid internal key. Ensure INTERNAL_SERVICE_KEY in evaluation/.env matches ai-chatbot-service",
                    "model": "unknown",
                    "provider": "error",
                    "latencyMs": latency_ms,
                }

            # Rate Limit (429) handling
            if response.status_code == 429:
                backoff_wait = 5.0 * attempt
                print(f"[429 RateLimit, retry in {backoff_wait:.0f}s...]", end=" ", flush=True)
                time.sleep(backoff_wait)
                continue

            # Transient 5xx server errors
            if response.status_code in (500, 502, 503, 504) and attempt < max_retries:
                backoff_wait = 2.0 * attempt
                print(f"[{response.status_code} Err, retry in {backoff_wait:.0f}s...]", end=" ", flush=True)
                time.sleep(backoff_wait)
                continue

            return {
                "type": "error",
                "reply": f"[HTTP {response.status_code}] {response.text}",
                "model": "unknown",
                "provider": "error",
                "latencyMs": latency_ms,
            }
        except httpx.TimeoutException:
            latency_ms = (time.perf_counter() - start_time) * 1000
            if attempt < max_retries:
                backoff_wait = 2.0 * attempt
                print(f"[Timeout, retry in {backoff_wait:.0f}s...]", end=" ", flush=True)
                time.sleep(backoff_wait)
                continue
            return {
                "type": "connection_error",
                "reply": "[Exception] Request timed out after retries",
                "model": "unknown",
                "provider": "error",
                "latencyMs": latency_ms,
            }
        except Exception as exc:
            latency_ms = (time.perf_counter() - start_time) * 1000
            last_error_text = str(exc)
            if attempt < max_retries:
                backoff_wait = 2.0 * attempt
                print(f"[ConnErr, retry in {backoff_wait:.0f}s...]", end=" ", flush=True)
                time.sleep(backoff_wait)
                continue

    return {
        "type": "connection_error",
        "reply": f"[Exception after {max_retries} retries] {last_error_text}",
        "model": "unknown",
        "provider": "error",
        "latencyMs": 0.0,
    }


def main():
    args = parse_args()
    output_path = Path(args.output)

    masked_key = (args.key[:4] + "***" + args.key[-3:]) if len(args.key) > 7 else ("***" if args.key else "NOT SET")

    print("=" * 75)
    print("  SENTIMETA ASSISTANT — SINGLE-TURN BENCHMARK PIPELINE (RESUME READY)")
    print("=" * 75)
    print(f"[*] Target Endpoint : {args.endpoint}")
    print(f"[*] Internal Key    : {masked_key} (Header: 'x-internal-key')")
    print(f"[*] Dataset Source   : {DATASET_FILE}")
    print(f"[*] Output Path      : {output_path.resolve()}")
    print(f"[*] Auto-Resume      : {'DISABLED (--no-resume)' if args.no_resume else 'ENABLED (Skips succeeded, auto-retries fallback & errors)'}")

    if not DATASET_FILE.exists():
        print(f"[ERROR] Dataset file not found: {DATASET_FILE}")
        sys.exit(1)

    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        all_cases = json.load(f)

    all_case_order = {c["id"]: i for i, c in enumerate(all_cases)}

    # Filter by category if requested
    filtered_cases = all_cases
    if args.category:
        filtered_cases = [c for c in filtered_cases if c.get("category") == args.category]
        print(f"[*] Filtered by category '{args.category}': {len(filtered_cases)} cases")

    # Limit cases if requested
    if args.limit > 0:
        filtered_cases = filtered_cases[: args.limit]
        print(f"[*] Limited to first {args.limit} cases")

    total_cases = len(filtered_cases)

    # Check for existing checkpoint
    stored_records: Dict[str, Dict[str, Any]] = {}
    if not args.no_resume:
        stored_records = load_existing_results(output_path)
        if stored_records:
            print(f"[*] Found checkpoint with {len(stored_records)} previously recorded cases.")

    headers = {
        "x-internal-key": args.key,
        "content-type": "application/json",
    }

    skipped_count = 0
    newly_called_count = 0

    print(f"[*] Processing pipeline across {total_cases} cases...\n")

    try:
        with httpx.Client(trust_env=False, timeout=args.timeout) as client:
            for idx, case in enumerate(filtered_cases, start=1):
                case_id = case["id"]
                cat = case["category"]
                query_preview = case["query"][:40] + "..." if len(case["query"]) > 40 else case["query"]

                # Check if case can be resumed from existing checkpoint
                prev_record = stored_records.get(case_id)
                can_skip = False
                if prev_record and not args.no_resume:
                    prev_resp = prev_record.get("bot_response", {})
                    prev_type = prev_resp.get("type", "")
                    prev_provider = prev_resp.get("provider", "")

                    # Fallback or error responses are NOT considered completed -> will be re-run!
                    is_valid = prev_type not in ("error", "connection_error", "fallback", "")
                    can_skip = is_valid

                if can_skip and prev_record is not None:
                    skipped_count += 1
                    resp_type = prev_record.get("bot_response", {}).get("type", "unknown")
                    print(f"[{idx:03d}/{total_cases:03d}] {case_id} ({cat}): [RESUMED / SKIPPED - {resp_type}]")
                    continue

                # Execute new call (for new cases, or re-running fallbacks/errors)
                newly_called_count += 1
                reason_tag = f"RE-RUN ({prev_record.get('bot_response', {}).get('type')})" if prev_record else "NEW"
                print(f"[{idx:03d}/{total_cases:03d}] {case_id} ({cat}) [{reason_tag}]: \"{query_preview}\" ... ", end="", flush=True)

                # Sinh session_user_id độc lập cho mỗi câu hỏi single-turn (ví dụ: eval_x001_8a2f1b)
                # Đảm bảo Redis SessionMemory hoàn toàn sạch sẽ (Cold Start), không bị ô nhiễm lịch sử từ các câu trước
                base_user_id = case["user_context"].get("user_id", f"eval_{case['id']}")
                session_user_id = f"{base_user_id}_{uuid.uuid4().hex[:6]}"

                bot_data = call_chatbot_api(
                    client=client,
                    endpoint=args.endpoint,
                    headers=headers,
                    case=case,
                    session_user_id=session_user_id,
                    timeout=args.timeout,
                    max_retries=args.max_retries,
                )

                resp_type = bot_data.get("type", "unknown")
                latency = bot_data.get("latencyMs", 0.0)

                if resp_type not in ("error", "connection_error", "fallback"):
                    status_str = f"OK [{resp_type}] ({latency:.0f}ms)"
                elif resp_type == "fallback":
                    status_str = f"FALLBACK (Timeout > 7s) ({latency:.0f}ms)"
                else:
                    status_str = f"FAILED [{resp_type}] ({latency:.0f}ms)"

                print(status_str)

                record = {
                    "case_id": case["id"],
                    "category": case["category"],
                    "subtopic": case["subtopic"],
                    "source_standard": case.get("source_standard", "Unknown"),
                    "user_query": case["query"],
                    "user_context": {
                        **case["user_context"],
                        "session_user_id": session_user_id,
                    },
                    "reference_ground_truth": case["reference_ground_truth"],
                    "evaluation_criteria_focus": case["evaluation_criteria_focus"],
                    "bot_response": {
                        "type": resp_type,
                        "reply": bot_data.get("reply", ""),
                        "sources": bot_data.get("sources", []),
                        "model": bot_data.get("model", ""),
                        "provider": bot_data.get("provider", ""),
                        "latency_ms": latency,
                        "crisis_info": bot_data.get("crisis"),
                    },
                    "executed_at": datetime.utcnow().isoformat() + "Z",
                }
                stored_records[case_id] = record

                # ATOMIC INCREMENTAL SAVE: Updates in-place, preserving all records in original dataset order
                ordered_list = sorted(
                    stored_records.values(),
                    key=lambda r: all_case_order.get(r.get("case_id"), 9999),
                )
                atomic_save_json(output_path, ordered_list)

                if args.delay > 0 and idx < total_cases:
                    time.sleep(args.delay)

    except KeyboardInterrupt:
        print("\n\n[!] EXECUTION PAUSED BY USER (Ctrl+C).")
        print(f"[*] Safely preserved {len(stored_records)} cases in: {output_path.resolve()}")
        print("[*] You can resume anytime by running the exact same command!")
        sys.exit(0)

    # Final save and summary
    ordered_list = sorted(
        stored_records.values(),
        key=lambda r: all_case_order.get(r.get("case_id"), 9999),
    )
    atomic_save_json(output_path, ordered_list)

    total_saved = len(ordered_list)
    successful_calls = sum(1 for r in ordered_list if r.get("bot_response", {}).get("type") not in ("error", "connection_error", "fallback"))
    fallback_calls = sum(1 for r in ordered_list if r.get("bot_response", {}).get("type") == "fallback")
    types_count: Dict[str, int] = {}
    for r in ordered_list:
        t = r.get("bot_response", {}).get("type", "unknown")
        types_count[t] = types_count.get(t, 0) + 1

    print("\n" + "=" * 75)
    print("  EXECUTION COMPLETED — SUMMARY STATISTICS")
    print("=" * 75)
    print(f"  - Target Cases          : {total_cases}")
    print(f"  - Resumed / Skipped     : {skipped_count}")
    print(f"  - Newly Called/Re-run   : {newly_called_count}")
    print(f"  - Total Saved in JSON   : {total_saved}")
    print(f"  - Valid Answers         : {successful_calls} / {total_saved} ({(successful_calls/total_saved*100 if total_saved else 0):.1f}%)")
    print(f"  - Fallbacks (Timeout)   : {fallback_calls}")
    print(f"  - Response Types Count  : {types_count}")
    print(f"  - Saved Output File     : {output_path.resolve()}")
    print("=" * 75)
    print("[+] Results saved safely!")


if __name__ == "__main__":
    main()
