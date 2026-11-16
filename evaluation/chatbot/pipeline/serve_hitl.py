"""Lightweight Python Web Server for Human-in-the-Loop (HITL) Evaluation Dashboard.

Serves the interactive web interface at http://localhost:8080.
Supports multi-reviewer evaluation:
  - Generates separate evaluation files per reviewer (e.g. `human_eval_single_le_van_huy.json`)
    to preserve the original files and enable Inter-Annotator Agreement (Human vs Human).
  - Provides REST APIs to stream cases, save evaluations per reviewer, and list reviewers.
Zero external dependencies (uses standard library http.server).
"""

import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import webbrowser
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# Paths
CURRENT_DIR = Path(__file__).resolve().parent
CHATBOT_EVAL_DIR = CURRENT_DIR.parent
RESULTS_DIR = CHATBOT_EVAL_DIR / "results"
UI_DIR = CHATBOT_EVAL_DIR / "ui"
DASHBOARD_FILE = UI_DIR / "hitl_dashboard.html"

SINGLE_RESPONSES_FILE = RESULTS_DIR / "single_turn_responses.json"
SINGLE_JUDGMENTS_FILE = RESULTS_DIR / "single_turn_judgments.json"
MULTI_RESPONSES_FILE = RESULTS_DIR / "multi_turn_responses.json"
MULTI_JUDGMENTS_FILE = RESULTS_DIR / "multi_turn_judgments.json"


def slugify(text: str) -> str:
    """Converts a reviewer name like 'Lê Văn Huy' into 'le_van_huy'."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    text = re.sub(r"[^\w\s-]", "", text).strip().lower()
    return re.sub(r"[-\s]+", "_", text) or "reviewer"


def get_reviewer_file_path(reviewer_name: str, mode: str) -> Path:
    slug = slugify(reviewer_name)
    mode_str = "single" if mode == "single" else "multi"
    return RESULTS_DIR / f"human_eval_{mode_str}_{slug}.json"


def read_json_file(path: Path) -> Any:
    if not path.exists() or path.stat().st_size == 0:
        return [] if "responses" in path.name else {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return [] if "responses" in path.name else {}


def save_json_file(path: Path, data: Any):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


class HitlRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query_params = urllib.parse.parse_qs(parsed_url.query)

        if path in ("/", "/index.html", "/dashboard"):
            if not DASHBOARD_FILE.exists():
                self.send_error(HTTPStatus.NOT_FOUND, "hitl_dashboard.html not found")
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            with open(DASHBOARD_FILE, "rb") as f:
                self.wfile.write(f.read())
            return

        if path == "/api/data":
            reviewer_name = query_params.get("reviewer", [""])[0]
            mode = query_params.get("mode", ["single"])[0]

            single_resp = read_json_file(SINGLE_RESPONSES_FILE)
            single_j_list = read_json_file(SINGLE_JUDGMENTS_FILE)
            single_j_map = {r["case_id"]: r for r in single_j_list if isinstance(r, dict) and "case_id" in r}

            multi_resp = read_json_file(MULTI_RESPONSES_FILE)
            multi_j_list = read_json_file(MULTI_JUDGMENTS_FILE)
            multi_j_map = {r["dialogue_id"]: r for r in multi_j_list if isinstance(r, dict) and "dialogue_id" in r}

            # Load reviewer-specific human evaluations
            human_evals = {}
            active_file_name = ""
            if reviewer_name:
                rev_file = get_reviewer_file_path(reviewer_name, mode)
                active_file_name = rev_file.name
                loaded = read_json_file(rev_file)
                if isinstance(loaded, dict):
                    human_evals = loaded
                elif isinstance(loaded, list):
                    id_key = "case_id" if mode == "single" else "dialogue_id"
                    human_evals = {r[id_key]: r for r in loaded if id_key in r}

            payload = {
                "single_responses": single_resp,
                "single_judgments": single_j_map,
                "multi_responses": multi_resp,
                "multi_judgments": multi_j_map,
                "human_evaluations": human_evals,
                "active_file_name": active_file_name,
            }

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self):
        if self.path == "/api/save-human-evaluation":
            content_length = int(self.headers.get("Content-Length", 0))
            post_body = self.rfile.read(content_length)

            try:
                eval_item = json.loads(post_body.decode("utf-8"))
                case_id = eval_item.get("case_id")
                reviewer_name = eval_item.get("reviewer_name", "").strip()
                mode = eval_item.get("mode", "single")

                if not case_id:
                    self.send_error(HTTPStatus.BAD_REQUEST, "Missing case_id")
                    return
                if not reviewer_name:
                    self.send_error(HTTPStatus.BAD_REQUEST, "Missing reviewer_name")
                    return

                # Target file dedicated to this reviewer
                target_file = get_reviewer_file_path(reviewer_name, mode)

                current_evals = read_json_file(target_file)
                if not isinstance(current_evals, dict):
                    current_evals = {}

                current_evals[case_id] = eval_item
                save_json_file(target_file, current_evals)

                response_payload = {
                    "status": "success",
                    "saved_id": case_id,
                    "saved_file": target_file.name,
                    "total_reviewed": len(current_evals),
                }

                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps(response_payload, ensure_ascii=False).encode("utf-8"))
                return

            except Exception as exc:
                self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Save error: {exc}")
                return

        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")


def run_server(port: int = 8080, open_browser: bool = False):
    server_address = ("", port)
    httpd = HTTPServer(server_address, HitlRequestHandler)

    url = f"http://localhost:{port}"
    print("=" * 75)
    print("  SENTIMETA ASSISTANT — HUMAN-IN-THE-LOOP (HITL) MULTI-REVIEWER SERVER")
    print("=" * 75)
    print(f"[*] Dashboard URL    : {url}")
    print(f"[*] HTML Template    : {DASHBOARD_FILE.resolve()}")
    print(f"[*] Results Directory: {RESULTS_DIR.resolve()}")
    print("=" * 75)
    print("[+] Press Ctrl+C to stop the server anytime.\n")

    if open_browser:
        webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Server stopped cleanly by user.")
        httpd.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Serve Sentimeta HITL Evaluation Dashboard")
    parser.add_argument("--port", type=int, default=8080, help="Server port (default: 8080)")
    parser.add_argument("--open", action="store_true", help="Automatically open browser")
    args = parser.parse_args()

    run_server(port=args.port, open_browser=args.open)
