"""
========================================================================================
LOCAL SERVER CHO GIAO DIỆN ĐỐI SOÁT BENCHMARK VLM VS CHUẨN VÀNG (SE121)
========================================================================================
Mục đích:
  - Khởi chạy HTTP Server nội bộ phục vụ giao diện benchmark_comparison_ui.html
  - Tự động mở trình duyệt web đến giao diện đối soát
  - Hỗ trợ đầy đủ dữ liệu:
      1. Kết quả VLM: results/benchmark_evaluation_results.json
      2. Chuẩn vàng sạch: data/benchmark_gold_clean.json
      3. Tập đối soát chi tiết Annotator 1 vs Annotator 2: data/multimodal_gold_test_set.json
      4. Ảnh kiểm thử: data/images/*.jpg

Cách chạy:
  python evaluation/image-experiment/run_comparison_ui.py
  (Tùy chọn cổng: python evaluation/image-experiment/run_comparison_ui.py --port 8085)
========================================================================================
"""

import os
import sys
import json
import argparse
import webbrowser
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

# Cấu hình UTF-8 cho Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent.parent
DEFAULT_PORT = 8085

GOLD_CLEAN_FILE = BASE_DIR / "data" / "benchmark_gold_clean.json"
GOLD_FULL_FILE = BASE_DIR / "data" / "multimodal_gold_test_set.json"
RESULTS_FILE = BASE_DIR / "results" / "benchmark_evaluation_results.json"
HTML_FILE = BASE_DIR / "benchmark_comparison_ui.html"


class BenchmarkComparisonHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Phục vụ thư mục BASE_DIR (image-experiment) làm gốc
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def translate_path(self, path):
        parsed = urlparse(path).path
        clean = parsed.replace("\\", "/")

        if clean in ["/", "/index.html", "/ui", "/compare"]:
            return str(HTML_FILE)

        if clean.startswith("/image-experiment/"):
            clean = clean[len("/image-experiment/"):]

        target = BASE_DIR / clean.lstrip("/")
        if target.exists():
            return str(target)

        # Fallback to repo root
        repo_target = REPO_ROOT / clean.lstrip("/")
        if repo_target.exists():
            return str(repo_target)

        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        if self.path.endswith(".html") or self.path.endswith(".json"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, format, *args):
        msg = format % args
        if "200 -" in msg and (".jpg" in msg or ".png" in msg):
            return
        sys.stdout.write(f"[{self.log_date_time_string()}] {msg}\n")


def print_quick_summary():
    """In thông số đối soát ra console."""
    if not GOLD_CLEAN_FILE.exists() or not RESULTS_FILE.exists():
        print("⚠️ Cảnh báo: Chưa tìm thấy đầy đủ file benchmark clean hoặc results.")
        return

    try:
        with open(GOLD_CLEAN_FILE, "r", encoding="utf-8") as f:
            clean = json.load(f)
        with open(RESULTS_FILE, "r", encoding="utf-8") as f:
            res = json.load(f)

        full_map = {}
        if GOLD_FULL_FILE.exists():
            with open(GOLD_FULL_FILE, "r", encoding="utf-8") as f:
                full_list = json.load(f)
                full_map = {x["id"]: x for x in full_list}

        total = len(clean)
        vlm_matches = 0
        vlm_wrong = 0
        annotator_agreed = 0
        annotator_diff = 0

        for g in clean:
            sid = g.get("id")
            r = res.get(sid, {})
            gt_emo = g.get("ground_truth", {}).get("combined_emotion", "").lower()
            pred_emo = r.get("predicted_primary_emotion", "").lower()

            if gt_emo == pred_emo:
                vlm_matches += 1
            else:
                vlm_wrong += 1

            status = g.get("adjudication_status") or (full_map.get(sid, {}).get("adjudication_status", ""))
            if status == "AUTO_RESOLVED":
                annotator_agreed += 1
            else:
                annotator_diff += 1

        acc = (vlm_matches / total * 100) if total > 0 else 0.0

        print("\n" + "=" * 78)
        print("  📊 TỔNG HỢP NHANH DỮ LIỆU ĐỐI SOÁT BENCHMARK")
        print("=" * 78)
        print(f"  • Tổng số mẫu sạch:              {total}")
        print(f"  • VLM Dự đoán ĐÚNG:              {vlm_matches} ({acc:.2f}%)")
        print(f"  • VLM Dự đoán SAI (Lệch nhãn):   {vlm_wrong} ({100 - acc:.2f}%)")
        print(f"  • Annotators KHỚP (Đồng thuận):  {annotator_agreed} mẫu ({annotator_agreed/total*100:.1f}%)")
        print(f"  • Annotators BẤT ĐỒNG (Hòa giải): {annotator_diff} mẫu ({annotator_diff/total*100:.1f}%)")
        print("=" * 78 + "\n")
    except Exception as e:
        print(f"Lỗi đọc dữ liệu: {e}")


def main():
    parser = argparse.ArgumentParser(description="Khởi chạy UI đối soát Benchmark VLM")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Cổng chạy máy chủ (mặc định: {DEFAULT_PORT})")
    parser.add_argument("--no-browser", action="store_true", help="Không tự động mở trình duyệt")
    args = parser.parse_args()

    print_quick_summary()

    server_address = ("", args.port)
    httpd = HTTPServer(server_address, BenchmarkComparisonHandler)
    url = f"http://localhost:{args.port}/benchmark_comparison_ui.html"

    print(f"🚀 Máy chủ UI Đối Soát Benchmark đang chạy tại: {url}")
    print("   Bấm Ctrl+C để dừng máy chủ bất kỳ lúc nào.\n")

    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[OK] Đã dừng máy chủ thành công.")
        httpd.server_close()


if __name__ == "__main__":
    main()
