"""Script to execute the Multi-Turn Benchmark against the Sentimeta Chatbot Service.

Maintains sequential conversational state (session history) across multi-turn interactions.
Includes Checkpoint & Resume:
  - Real-time incremental saving after EVERY completed dialogue (no loss on crash/interrupt).
  - Auto-resumes from existing results (skips succeeded dialogues, auto-retries dialogues with fallback or errors).
  - Preserves previously saved records across partial/filtered runs.
  - Auto-loads INTERNAL_SERVICE_KEY from evaluation/.env.
  - Safe atomic file writes to prevent JSON corruption on sudden aborts.
Results are saved to `evaluation/chatbot/results/multi_turn_responses.json`.
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
DATASET_FILE = CHATBOT_EVAL_DIR / "data" / "multi_turn_benchmark_cases.json"
DEFAULT_OUTPUT_FILE = CHATBOT_EVAL_DIR / "results" / "multi_turn_responses.json"

# Load config from evaluation/.env
load_dotenv(EVAL_DIR / ".env")
load_dotenv()

RESOLVED_INTERNAL_KEY = os.getenv("INTERNAL_SERVICE_KEY", "")


def parse_args():
    parser = argparse.ArgumentParser(description="Execute Multi-Turn Chatbot Benchmark with Checkpoint & Resume")
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
        help="Limit number of dialogues to run (0 = run all dialogues)",
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
        default=0.3,
        help="Delay in seconds between turns (increase if hitting Groq rate limits)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=40.0,
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
        help="Ignore existing checkpoint and re-run all dialogues from scratch",
    )
    parser.add_argument(
        "--inject-history",
        action="store_true",
        help="Explicitly send history array in request body (default: False, lets backend Redis SessionMemory manage conversation history just like production FE/Gateway)",
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
                return {r["dialogue_id"]: r for r in records if "dialogue_id" in r}
    except Exception as exc:
        print(f"[!] Warning: Could not read existing output file ({exc}). Starting fresh.")
    return {}


def call_chatbot_turn(
    client: httpx.Client,
    endpoint: str,
    headers: Dict[str, str],
    dialogue: Dict[str, Any],
    turn: Dict[str, Any],
    session_user_id: str,
    history: List[Dict[str, str]],
    timeout: float,
    max_retries: int = 3,
    inject_history: bool = False,
) -> Dict[str, Any]:
    """Sends a single turn to the chatbot API, maintaining conversationId for multi-turn state."""
    conv_id = f"eval_multi_{dialogue['dialogue_id']}"
    t_idx = turn["turn_index"]

    payload = {
        "userId": session_user_id,
        "conversationId": conv_id,
        "message": turn["user_query"],
        "clientMessageId": f"eval-msg-{dialogue['dialogue_id']}-t{t_idx}",
    }

    # By default, we let the backend manage history via Redis SessionMemory just like production.
    # If inject_history is enabled, we explicitly pass the history array in the request body.
    if inject_history and history:
        payload["history"] = [
            {"role": h["role"], "content": h["content"]}
            for h in history
            if h.get("role") in ("user", "assistant") and h.get("content")
        ]

    last_error_text = ""
    for attempt in range(1, max_retries + 1):
        start_time = time.perf_counter()
        try:
            response = client.post(
                endpoint,
                headers=headers,
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
    print("  SENTIMETA ASSISTANT — MULTI-TURN BENCHMARK PIPELINE (RESUME READY)")
    print("=" * 75)
    print(f"[*] Target Endpoint : {args.endpoint}")
    print(f"[*] Internal Key    : {masked_key} (Header: 'x-internal-key')")
    print(f"[*] Dataset Source   : {DATASET_FILE}")
    print(f"[*] Output Path      : {output_path.resolve()}")
    print(f"[*] Memory Mode      : {'INJECT HISTORY (Client overrides backend)' if args.inject_history else 'BACKEND SESSION MEMORY (Production Redis mode - FE/Gateway standard)'}")
    print(f"[*] Auto-Resume      : {'DISABLED (--no-resume)' if args.no_resume else 'ENABLED (Skips succeeded, auto-retries fallback & errors)'}")

    if not DATASET_FILE.exists():
        print(f"[ERROR] Multi-turn dataset file not found: {DATASET_FILE}")
        sys.exit(1)

    with open(DATASET_FILE, "r", encoding="utf-8") as f:
        all_dialogues = json.load(f)

    all_dialogue_order = {d["dialogue_id"]: i for i, d in enumerate(all_dialogues)}

    # Filter by category if requested
    filtered_dialogues = all_dialogues
    if args.category:
        filtered_dialogues = [d for d in filtered_dialogues if d.get("category") == args.category]
        print(f"[*] Filtered by category '{args.category}': {len(filtered_dialogues)} dialogues")

    # Limit dialogues if requested
    if args.limit > 0:
        filtered_dialogues = filtered_dialogues[: args.limit]
        print(f"[*] Limited to first {args.limit} dialogues")

    total_dialogues = len(filtered_dialogues)
    total_turns_planned = sum(len(d["turns"]) for d in filtered_dialogues)

    # Check for existing checkpoint
    stored_dialogues: Dict[str, Dict[str, Any]] = {}
    if not args.no_resume:
        stored_dialogues = load_existing_results(output_path)
        if stored_dialogues:
            print(f"[*] Found checkpoint with {len(stored_dialogues)} previously recorded dialogues.")

    headers = {
        "x-internal-key": args.key,
        "content-type": "application/json",
    }

    skipped_dialogues = 0
    newly_executed = 0

    print(f"[*] Processing {total_dialogues} dialogues ({total_turns_planned} turns)...\n")

    try:
        with httpx.Client(trust_env=False, timeout=args.timeout) as client:
            for d_idx, dialogue in enumerate(filtered_dialogues, start=1):
                dlg_id = dialogue["dialogue_id"]
                cat = dialogue["category"]
                title = dialogue.get("title", "Untitled Dialogue")
                num_turns = len(dialogue["turns"])

                # Check if dialogue can be resumed from existing checkpoint
                prev_record = stored_dialogues.get(dlg_id)
                can_skip = False
                if prev_record and not args.no_resume:
                    prev_turns = prev_record.get("turns", [])
                    # Auto re-run if any turn failed or timed out with fallback
                    has_error = any(
                        t.get("bot_response", {}).get("type") in ("error", "connection_error", "fallback")
                        for t in prev_turns
                    )
                    is_complete = len(prev_turns) == num_turns
                    can_skip = (is_complete and not has_error)

                if can_skip and prev_record is not None:
                    skipped_dialogues += 1
                    turns_len = len(prev_record.get("turns", []))
                    print(f"[*] [{d_idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}): [RESUMED / SKIPPED - {turns_len} turns completed]")
                    continue

                newly_executed += 1
                reason_tag = "RE-RUN" if prev_record else "NEW"
                print(f"[*] [{d_idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}) [{reason_tag}]: \"{title}\" [{num_turns} turns]")

                # Sinh session_user_id độc lập cho mỗi lần chạy kịch bản (ví dụ: eval_mt_x001_a8f1b2)
                # Đảm bảo Redis SessionMemory hoàn toàn mới tinh 100%, không dính tàn dư từ lần chạy trước
                run_token = uuid.uuid4().hex[:6]
                base_user_id = dialogue["user_context"]["user_id"]
                session_user_id = f"{base_user_id}_{run_token}"

                conversation_history: List[Dict[str, str]] = []
                executed_turns: List[Dict[str, Any]] = []

                for turn in dialogue["turns"]:
                    t_idx = turn["turn_index"]
                    user_msg = turn["user_query"]
                    msg_preview = user_msg[:36] + "..." if len(user_msg) > 36 else user_msg

                    print(f"    -> Turn {t_idx}/{num_turns}: \"{msg_preview}\" ... ", end="", flush=True)

                    bot_data = call_chatbot_turn(
                        client=client,
                        endpoint=args.endpoint,
                        headers=headers,
                        dialogue=dialogue,
                        turn=turn,
                        session_user_id=session_user_id,
                        history=conversation_history,
                        timeout=args.timeout,
                        max_retries=args.max_retries,
                        inject_history=args.inject_history,
                    )

                    resp_type = bot_data.get("type", "unknown")
                    reply_text = bot_data.get("reply", "")
                    latency = bot_data.get("latencyMs", 0.0)

                    if resp_type not in ("error", "connection_error", "fallback"):
                        status_str = f"OK [{resp_type}] ({latency:.0f}ms)"
                    elif resp_type == "fallback":
                        status_str = f"FALLBACK (Timeout > 7s) ({latency:.0f}ms)"
                    else:
                        status_str = f"FAILED [{resp_type}] ({latency:.0f}ms)"
                    print(status_str)

                    executed_turns.append({
                        "turn_index": t_idx,
                        "user_query": user_msg,
                        "bot_response": {
                            "type": resp_type,
                            "reply": reply_text,
                            "sources": bot_data.get("sources", []),
                            "model": bot_data.get("model", ""),
                            "provider": bot_data.get("provider", ""),
                            "latency_ms": latency,
                            "crisis_info": bot_data.get("crisis"),
                        },
                        "expected_elements": turn.get("expected_elements", []),
                        "forbidden_behaviors": turn.get("forbidden_behaviors", []),
                        "context_retention_check": turn.get("context_retention_check"),
                        "reference_gist": turn.get("reference_gist", ""),
                    })

                    # Maintain history for next turns
                    conversation_history.append({"role": "user", "content": user_msg})
                    conversation_history.append({"role": "assistant", "content": reply_text})

                    if args.delay > 0:
                        time.sleep(args.delay)

                # Record dialogue
                dialogue_record = {
                    "dialogue_id": dlg_id,
                    "category": cat,
                    "title": title,
                    "subtopic": dialogue.get("subtopic", ""),
                    "source_standard": dialogue.get("source_standard", "Unknown"),
                    "user_context": {
                        **dialogue["user_context"],
                        "session_user_id": session_user_id,
                    },
                    "evaluation_criteria_focus": dialogue.get("evaluation_criteria_focus", []),
                    "turns_count": len(executed_turns),
                    "turns": executed_turns,
                    "executed_at": datetime.utcnow().isoformat() + "Z",
                }
                stored_dialogues[dlg_id] = dialogue_record

                # ATOMIC INCREMENTAL SAVE: Preserve order and save after each completed dialogue
                ordered_dialogues = sorted(
                    stored_dialogues.values(),
                    key=lambda d: all_dialogue_order.get(d.get("dialogue_id"), 9999),
                )
                atomic_save_json(output_path, ordered_dialogues)

    except KeyboardInterrupt:
        print("\n\n[!] EXECUTION PAUSED BY USER (Ctrl+C).")
        print(f"[*] Safely preserved {len(stored_dialogues)} dialogues in: {output_path.resolve()}")
        print("[*] You can resume anytime by running the exact same command!")
        sys.exit(0)

    # Final save
    ordered_dialogues = sorted(
        stored_dialogues.values(),
        key=lambda d: all_dialogue_order.get(d.get("dialogue_id"), 9999),
    )
    atomic_save_json(output_path, ordered_dialogues)

    total_saved = len(ordered_dialogues)
    total_saved_turns = sum(len(d.get("turns", [])) for d in ordered_dialogues)

    print("\n" + "=" * 75)
    print("  MULTI-TURN EXECUTION COMPLETED — SUMMARY STATISTICS")
    print("=" * 75)
    print(f"  - Target Dialogues      : {total_dialogues}")
    print(f"  - Resumed / Skipped     : {skipped_dialogues}")
    print(f"  - Newly Executed/Re-run : {newly_executed}")
    print(f"  - Total Saved Dialogues : {total_saved} ({total_saved_turns} turns)")
    print(f"  - Saved Output File     : {output_path.resolve()}")
    print("=" * 75)
    print("[+] All multi-turn responses are safely saved!")


if __name__ == "__main__":
    main()
