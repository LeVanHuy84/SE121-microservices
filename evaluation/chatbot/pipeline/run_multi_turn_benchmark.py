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
from typing import Any, Dict, List, Optional, Tuple

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
        "--turn-delay",
        "--delay-single",
        dest="turn_delay",
        type=float,
        default=None,
        help="Delay in seconds between queries/turns within a dialogue session (default: 1.0s, alias: --delay-single)",
    )
    parser.add_argument(
        "--case-delay",
        "--dialogue-delay",
        dest="case_delay",
        type=float,
        default=None,
        help="Delay in seconds between dialogue cases (default: 0.5s)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=None,
        help="General delay in seconds. Sets both turn-delay and case-delay if they are not explicitly set",
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
        "--max-dialogue-retries",
        type=int,
        default=2,
        help="Max retry passes for dialogues aborted due to fallback/errors (default: 2)",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=5.0,
        help="Cooldown in seconds before retrying aborted dialogues (default: 5.0s)",
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


def get_valid_resumable_turns(
    prev_record: Optional[Dict[str, Any]],
    expected_turns: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Returns consecutive, successful turns from checkpoint that match the dataset."""
    if not prev_record:
        return []
    prev_turns = prev_record.get("turns", [])
    valid_turns: List[Dict[str, Any]] = []
    for exp_turn in expected_turns:
        t_idx = exp_turn["turn_index"]
        exp_query = exp_turn.get("user_query", "").strip()
        match = next((pt for pt in prev_turns if pt.get("turn_index") == t_idx), None)
        if not match:
            break
        # Verify query matches
        match_query = match.get("user_query", "").strip()
        if match_query != exp_query:
            break
        # Verify bot_response was not an error or fallback
        resp_type = match.get("bot_response", {}).get("type")
        if resp_type in ("error", "connection_error", "fallback"):
            break
        valid_turns.append(match)
    return valid_turns


def call_chatbot_turn(
    client: httpx.Client,
    endpoint: str,
    headers: Dict[str, str],
    dialogue: Dict[str, Any],
    turn: Dict[str, Any],
    session_user_id: str,
    session_conversation_id: str,
    history: List[Dict[str, str]],
    timeout: float,
    max_retries: int = 3,
    inject_history: bool = False,
) -> Dict[str, Any]:
    """Sends a single turn to the chatbot API, maintaining conversationId for multi-turn state."""
    conv_id = session_conversation_id
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
                    "reply": "[HTTP 403 Forbidden] Invalid internal key. Ensure INTERNAL_SERVICE_KEY in evaluation/.env matches ai-chatbot-service",
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


def execute_dialogue(
    client: httpx.Client,
    dialogue: Dict[str, Any],
    stored_dialogues: Dict[str, Dict[str, Any]],
    all_dialogue_order: Dict[str, int],
    output_path: Path,
    args: argparse.Namespace,
    headers: Dict[str, str],
    turn_delay: float,
    case_delay: float,
    d_idx: int,
    total_dialogues: int,
) -> Tuple[bool, bool]:
    """Executes a single dialogue case with turn-level resumption and immediate abort on fallback.

    Returns:
        (is_completed, was_skipped)
    """
    dlg_id = dialogue["dialogue_id"]
    cat = dialogue["category"]
    title = dialogue.get("title", "Untitled Dialogue")
    num_turns = len(dialogue["turns"])

    prev_record = stored_dialogues.get(dlg_id)
    valid_turns = get_valid_resumable_turns(prev_record, dialogue["turns"]) if not args.no_resume else []

    # Check if dialogue is already 100% complete
    if len(valid_turns) == num_turns:
        turns_len = len(valid_turns)
        print(f"[*] [{d_idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}): [RESUMED / SKIPPED - {turns_len} turns completed]")
        return True, True

    if len(valid_turns) > 0:
        reason_tag = f"RESUME ({len(valid_turns)}/{num_turns} turns cached)"
    elif prev_record:
        reason_tag = "RE-RUN"
    else:
        reason_tag = "NEW"

    print(f"[*] [{d_idx:02d}/{total_dialogues:02d}] Dialogue {dlg_id} ({cat}) [{reason_tag}]: \"{title}\" [{num_turns} turns]")

    # Resolve or create persistent session IDs across turns
    if len(valid_turns) > 0 and prev_record and "user_context" in prev_record:
        session_user_id = prev_record["user_context"].get("session_user_id")
        session_conv_id = prev_record["user_context"].get("session_conversation_id")
    else:
        session_user_id = None
        session_conv_id = None

    if not session_user_id or not session_conv_id:
        run_token = uuid.uuid4().hex[:6]
        base_user_id = dialogue["user_context"]["user_id"]
        base_session_id = dialogue["user_context"].get("session_id") or f"eval_sess_{dlg_id.lower()}"
        session_user_id = f"{base_user_id}_{run_token}"
        session_conv_id = f"{base_session_id}_{run_token}"

    conversation_history: List[Dict[str, str]] = []
    executed_turns: List[Dict[str, Any]] = []
    dialogue_aborted = False

    for t_idx_loop, turn in enumerate(dialogue["turns"]):
        t_idx = turn["turn_index"]
        user_msg = turn["user_query"]
        msg_preview = user_msg[:36] + "..." if len(user_msg) > 36 else user_msg

        # Re-use cached turn if already successfully executed
        cached_turn = next((vt for vt in valid_turns if vt.get("turn_index") == t_idx), None)
        if cached_turn:
            resp_type = cached_turn.get("bot_response", {}).get("type", "unknown")
            reply_text = cached_turn.get("bot_response", {}).get("reply", "")
            latency = cached_turn.get("bot_response", {}).get("latency_ms", 0.0)
            print(f"    -> Turn {t_idx}/{num_turns}: \"{msg_preview}\" ... [REUSED] OK [{resp_type}] ({latency:.0f}ms)")
            executed_turns.append(cached_turn)
            conversation_history.append({"role": "user", "content": user_msg})
            conversation_history.append({"role": "assistant", "content": reply_text})
            continue

        print(f"    -> Turn {t_idx}/{num_turns}: \"{msg_preview}\" ... ", end="", flush=True)

        bot_data = call_chatbot_turn(
            client=client,
            endpoint=args.endpoint,
            headers=headers,
            dialogue=dialogue,
            turn=turn,
            session_user_id=session_user_id,
            session_conversation_id=session_conv_id,
            history=conversation_history,
            timeout=args.timeout,
            max_retries=args.max_retries,
            inject_history=(args.inject_history or len(executed_turns) > 0),
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

        # Immediate abort on fallback or error to avoid token waste
        if resp_type in ("error", "connection_error", "fallback"):
            dialogue_aborted = True
            print(f"       [!] Turn {t_idx}/{num_turns} returned {resp_type.upper()}. Aborting case {dlg_id} to save tokens (will retry later).")
            break

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

        conversation_history.append({"role": "user", "content": user_msg})
        conversation_history.append({"role": "assistant", "content": reply_text})

        is_last_turn = (t_idx_loop == num_turns - 1)
        if not is_last_turn and turn_delay > 0:
            time.sleep(turn_delay)

    is_complete = (len(executed_turns) == num_turns and not dialogue_aborted)

    # Save progress if at least 1 turn succeeded
    if executed_turns:
        dialogue_record = {
            "dialogue_id": dlg_id,
            "category": cat,
            "title": title,
            "subtopic": dialogue.get("subtopic", ""),
            "source_standard": dialogue.get("source_standard", "Unknown"),
            "user_context": {
                **dialogue["user_context"],
                "session_user_id": session_user_id,
                "session_conversation_id": session_conv_id,
            },
            "evaluation_criteria_focus": dialogue.get("evaluation_criteria_focus", []),
            "turns_count": len(executed_turns),
            "is_complete": is_complete,
            "turns": executed_turns,
            "executed_at": datetime.utcnow().isoformat() + "Z",
        }
        stored_dialogues[dlg_id] = dialogue_record

        ordered_dialogues = sorted(
            stored_dialogues.values(),
            key=lambda d: all_dialogue_order.get(d.get("dialogue_id"), 9999),
        )
        atomic_save_json(output_path, ordered_dialogues)

    if case_delay > 0 and d_idx < total_dialogues:
        time.sleep(case_delay)

    return is_complete, False


def main():
    args = parse_args()
    output_path = Path(args.output)

    masked_key = (args.key[:4] + "***" + args.key[-3:]) if len(args.key) > 7 else ("***" if args.key else "NOT SET")

    # Resolve delay timings
    if args.turn_delay is not None:
        turn_delay = max(0.0, args.turn_delay)
    elif args.delay is not None:
        turn_delay = max(0.0, args.delay)
    else:
        turn_delay = 1.0

    if args.case_delay is not None:
        case_delay = max(0.0, args.case_delay)
    elif args.delay is not None:
        case_delay = max(0.0, args.delay)
    else:
        case_delay = 0.5

    print("=" * 75)
    print("  SENTIMETA ASSISTANT — MULTI-TURN BENCHMARK PIPELINE (RESUME READY)")
    print("=" * 75)
    print(f"[*] Target Endpoint : {args.endpoint}")
    print(f"[*] Internal Key    : {masked_key} (Header: 'x-internal-key')")
    print(f"[*] Dataset Source   : {DATASET_FILE}")
    print(f"[*] Output Path      : {output_path.resolve()}")
    print(f"[*] Turn Delay       : {turn_delay:.2f}s (between queries in a session)")
    print(f"[*] Dialogue Delay   : {case_delay:.2f}s (between dialogue cases)")
    print(f"[*] Max Retries/Case : {args.max_dialogue_retries} passes (cooldown {args.retry_delay:.0f}s)")
    print(f"[*] Memory Mode      : {'INJECT HISTORY (Client overrides backend)' if args.inject_history else 'SMART CONTEXT (Redis session + auto-injected cached turns on resume)'}")
    print(f"[*] Auto-Resume      : {'DISABLED (--no-resume)' if args.no_resume else 'ENABLED (Turn-level resumption & cache reuse)'}")

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
    incomplete_dialogues: List[Dict[str, Any]] = []

    print(f"[*] Processing {total_dialogues} dialogues ({total_turns_planned} turns)...\n")

    try:
        with httpx.Client(trust_env=False, timeout=args.timeout) as client:
            # Main pass
            for d_idx, dialogue in enumerate(filtered_dialogues, start=1):
                completed, skipped = execute_dialogue(
                    client=client,
                    dialogue=dialogue,
                    stored_dialogues=stored_dialogues,
                    all_dialogue_order=all_dialogue_order,
                    output_path=output_path,
                    args=args,
                    headers=headers,
                    turn_delay=turn_delay,
                    case_delay=case_delay,
                    d_idx=d_idx,
                    total_dialogues=total_dialogues,
                )
                if skipped:
                    skipped_dialogues += 1
                else:
                    newly_executed += 1
                    if not completed:
                        incomplete_dialogues.append(dialogue)

            # Retry passes for incomplete dialogues
            retry_pass = 1
            while incomplete_dialogues and retry_pass <= args.max_dialogue_retries:
                print("\n" + "=" * 75)
                print(f"  RETRY PASS {retry_pass}/{args.max_dialogue_retries} — Retrying {len(incomplete_dialogues)} Incomplete Cases")
                print(f"  (Cooldown {args.retry_delay:.0f}s to allow provider rate limits to reset...)")
                print("=" * 75)
                time.sleep(args.retry_delay)

                current_retries = list(incomplete_dialogues)
                incomplete_dialogues.clear()

                for r_idx, dialogue in enumerate(current_retries, start=1):
                    completed, skipped = execute_dialogue(
                        client=client,
                        dialogue=dialogue,
                        stored_dialogues=stored_dialogues,
                        all_dialogue_order=all_dialogue_order,
                        output_path=output_path,
                        args=args,
                        headers=headers,
                        turn_delay=turn_delay,
                        case_delay=case_delay,
                        d_idx=r_idx,
                        total_dialogues=len(current_retries),
                    )
                    if not completed:
                        incomplete_dialogues.append(dialogue)

                retry_pass += 1

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
    fully_completed_dialogues = sum(1 for d in ordered_dialogues if d.get("is_complete", False))

    print("\n" + "=" * 75)
    print("  MULTI-TURN EXECUTION COMPLETED — SUMMARY STATISTICS")
    print("=" * 75)
    print(f"  - Target Dialogues      : {total_dialogues}")
    print(f"  - Resumed / Skipped     : {skipped_dialogues}")
    print(f"  - Newly Executed/Re-run : {newly_executed}")
    print(f"  - Fully Completed       : {fully_completed_dialogues}/{total_dialogues}")
    if incomplete_dialogues:
        print(f"  - Incomplete / Aborted  : {len(incomplete_dialogues)} (run again to resume remaining turns)")
    print(f"  - Total Saved Dialogues : {total_saved} ({total_saved_turns} turns)")
    print(f"  - Saved Output File     : {output_path.resolve()}")
    print("=" * 75)
    print("[+] All multi-turn responses are safely saved!")


if __name__ == "__main__":
    main()
