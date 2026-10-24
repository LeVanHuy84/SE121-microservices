"""
========================================================================================
HUMAN-IN-THE-LOOP LOCAL REVIEW SERVER (SE121 KLTN)
========================================================================================
Dự án: SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)
Mục đích:
  1. Tự động kiểm tra và tải gói dữ liệu kiểm thử Đa phương thức (vlm_dataset.json & 600 ảnh)
     từ GitHub Releases / Hugging Face / Google Drive nếu máy chưa có.
  2. Khởi chạy máy chủ cục bộ siêu nhẹ (chỉ dùng thư viện chuẩn Python) phục vụ giao diện:
     - Hiển thị danh sách file JSON trong data/ trực tiếp trên UI (không cần duyệt ổ đĩa).
     - Lưu tức thì khi bấm Đồng ý / Chỉnh sửa trực tiếp vào file JSON riêng trên đĩa.
     - Ghi nhận thông tin người thẩm định (reviewer_name) ở đầu file JSON.
     - Tự động mở trình duyệt web đến giao diện review.

Cách chạy:
  python evaluation\\image-experiment\\review_server.py
  (Hoặc truyền URL tùy chọn: python review_server.py --download-url <custom_url>)
========================================================================================
"""

import os
import sys
import re
import json
import time
import zipfile
import shutil
import argparse
import unicodedata
import webbrowser
from datetime import datetime
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
import urllib.request
import urllib.error

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
# Chỉ biết các thư mục ở trong evaluation, không phụ thuộc bên ngoài
EVALUATION_DIR = BASE_DIR.parent
DATA_DIR = BASE_DIR / "data"
DEFAULT_PORT = 8080

DEFAULT_DATASET_NAME = "vlm_dataset.json"
DEFAULT_DATASET_FILE = DATA_DIR / DEFAULT_DATASET_NAME

# URL tải mặc định gói dữ liệu benchmark vlm_benchmark_assets.zip (37 MB)
# Bạn có thể ghi đè qua biến môi trường VLM_ASSETS_URL hoặc cờ dòng lệnh --download-url
DEFAULT_ASSETS_URL = os.environ.get(
    "VLM_ASSETS_URL",
    "https://github.com/LeVanHuy84/SE121-microservices/releases/download/benchmark-v1.0/vlm_benchmark_assets.zip"
)

# Các tệp dữ liệu gốc / benchmark dùng chung — TUYỆT ĐỐI KHÔNG ĐƯỢC GHI ĐÈ!
PROTECTED_BASE_FILES = {
    DEFAULT_DATASET_NAME,
}


def slugify_name(name: str) -> str:
    """Tạo slug an toàn cho tên file từ tên người thẩm định (hỗ trợ tiếng Việt)."""
    if not name:
        return "reviewer"
    name = name.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFKD", name)
    s = s.encode("ascii", "ignore").decode("ascii")
    s = s.lower()
    s = re.sub(r"[^a-z0-9_-]+", "_", s)
    s = s.strip("_")
    return s or "reviewer"


# ========================================================================================
# CƠ CHẾ TỰ ĐỘNG KIỂM TRA & TẢI DỮ LIỆU BENCHMARK (ZERO DEPENDENCIES)
# ========================================================================================

def check_dataset_ready(data_dir: Path) -> tuple:
    """Kiểm tra xem bộ dữ liệu kiểm thử chuẩn và ảnh đã đầy đủ trên máy chưa."""
    dataset_file = data_dir / "vlm_dataset.json"
    images_dir = data_dir / "images"

    if not dataset_file.exists():
        return False, f"Chưa có tệp {dataset_file.name}"

    try:
        with open(dataset_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list) or len(data) == 0:
            return False, "Tệp vlm_dataset.json rỗng hoặc sai cấu trúc"
    except Exception as e:
        return False, f"Lỗi đọc {dataset_file.name}: {e}"

    if not images_dir.exists() or not images_dir.is_dir():
        return False, "Chưa có thư mục images/"

    img_count = len([f for f in os.listdir(images_dir) if (images_dir / f).is_file()])
    if img_count < 500:
        return False, f"Thư mục images/ chỉ có {img_count}/600 ảnh (chưa đủ dữ liệu)"

    return True, f"Đầy đủ {len(data)} mẫu kiểm thử và {img_count} hình ảnh"


def normalize_download_url(url: str) -> str:
    """Chuyển đổi các link chia sẻ (Google Drive, Hugging Face, GitHub) thành link tải trực tiếp."""
    url = url.strip()
    # Google Drive share link -> direct download link
    if "drive.google.com" in url:
        match = re.search(r"/d/([a-zA-Z0-9_-]+)", url) or re.search(r"id=([a-zA-Z0-9_-]+)", url)
        if match:
            file_id = match.group(1)
            return f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
    return url


def download_file_with_progress(url: str, dest_path: Path) -> bool:
    """Tải tệp từ internet có thanh hiển thị tiến trình (Progress Bar) bằng thư viện chuẩn."""
    clean_url = normalize_download_url(url)
    print(f"🌐 Đang kết nối tới: {clean_url}")

    req = urllib.request.Request(
        clean_url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    )

    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(req, timeout=30) as response, open(dest_path, "wb") as out_file:
            # Lấy dung lượng tệp từ Header
            total_size = response.getheader("Content-Length")
            total_bytes = int(total_size) if total_size and total_size.isdigit() else 0
            
            downloaded = 0
            block_size = 65536  # 64 KB
            start_time = time.time()
            bar_len = 30

            while True:
                buffer = response.read(block_size)
                if not buffer:
                    break
                downloaded += len(buffer)
                out_file.write(buffer)

                # Cập nhật hiển thị tiến trình
                elapsed = max(time.time() - start_time, 0.001)
                speed_mb = (downloaded / (1024 * 1024)) / elapsed
                
                if total_bytes > 0:
                    percent = min(100.0, (downloaded / total_bytes) * 100)
                    filled = int(bar_len * downloaded // total_bytes)
                    bar = "█" * filled + "░" * (bar_len - filled)
                    mb_cur = downloaded / (1024 * 1024)
                    mb_tot = total_bytes / (1024 * 1024)
                    sys.stdout.write(f"\r  [{bar}] {percent:5.1f}% ({mb_cur:5.1f}/{mb_tot:5.1f} MB) • {speed_mb:4.1f} MB/s")
                else:
                    mb_cur = downloaded / (1024 * 1024)
                    sys.stdout.write(f"\r  Đang tải: {mb_cur:5.1f} MB đã nhận • {speed_mb:4.1f} MB/s...")
                sys.stdout.flush()

        print("\n✓ Tải tệp dữ liệu hoàn tất!")
        return True
    except Exception as e:
        print(f"\n❌ Lỗi khi tải tệp: {e}")
        if dest_path.exists():
            try:
                dest_path.unlink()
            except Exception:
                pass
        return False


def extract_assets_zip(zip_path: Path, target_dir: Path) -> bool:
    """Giải nén tệp zip vào đúng thư mục data/."""
    print(f"📦 Đang giải nén {zip_path.name} vào {target_dir}...")
    target_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            members = zip_ref.namelist()
            print(f"  • Tổng số tệp trong zip: {len(members)}")
            zip_ref.extractall(target_dir)
        print("✓ Giải nén thành công!")
        return True
    except Exception as e:
        print(f"❌ Lỗi giải nén tệp zip: {e}")
        return False


def ensure_dataset_ready(data_dir: Path, download_url: str = DEFAULT_ASSETS_URL, force: bool = False) -> bool:
    """Đảm bảo vlm_dataset.json và 600 ảnh đã sẵn sàng trước khi bật server."""
    is_ready, reason = check_dataset_ready(data_dir)
    if is_ready and not force:
        print(f"✓ Dữ liệu kiểm thử đã sẵn sàng ({reason}).")
        return True

    print("=" * 80)
    print("⚠️  PHÁT HIỆN THIẾU DỮ LIỆU KIỂM THỬ ĐA PHƯƠNG THỨC!")
    print(f"    Trạng thái: {reason}")
    print("=" * 80)

    data_dir.mkdir(parents=True, exist_ok=True)

    # 1. Kiểm tra xem có file zip sẵn ở thư mục hiện tại không
    local_zip_candidates = [
        BASE_DIR / "vlm_benchmark_assets.zip",
        data_dir / "vlm_benchmark_assets.zip",
    ]
    for cand in local_zip_candidates:
        if cand.exists():
            print(f"💡 Tìm thấy tệp nén cục bộ: {cand.name}")
            if extract_assets_zip(cand, data_dir):
                is_ready, _ = check_dataset_ready(data_dir)
                if is_ready:
                    print("✓ Đã nạp thành công bộ dữ liệu từ tệp nén cục bộ!")
                    return True

    # 2. Tự động tải từ Remote URL
    active_url = download_url
    temp_zip = data_dir / "vlm_benchmark_assets.zip.tmp"
    
    download_success = False
    if active_url:
        print(f"🚀 Tự động tải bộ dữ liệu kiểm thử chuẩn (37 MB)...")
        download_success = download_file_with_progress(active_url, temp_zip)

    # 3. Nếu chưa cấu hình URL hoặc tải thất bại, cho phép người dùng nhập link
    if not download_success:
        print("\n" + "-" * 80)
        print("💡 HƯỚNG DẪN CẤP DỮ LIỆU:")
        print("  Cách 1: Dán đường link tải trực tiếp (GitHub Release / Hugging Face / Google Drive).")
        print("  Cách 2: Đặt tệp 'vlm_benchmark_assets.zip' vào thư mục:")
        print(f"          {BASE_DIR}")
        print("-" * 80)
        try:
            user_url = input("\n👉 Nhập link tải trực tiếp (hoặc Enter để hủy): ").strip()
            if user_url:
                download_success = download_file_with_progress(user_url, temp_zip)
        except (KeyboardInterrupt, EOFError):
            print("\nĐã hủy thao tác.")
            return False

    if not download_success:
        print("\n❌ KHÔNG THỂ KHỞI ĐỘNG MÁY CHỦ: Thiếu dữ liệu ảnh và tệp vlm_dataset.json!")
        return False

    # 4. Giải nén và dọn dẹp
    extract_success = extract_assets_zip(temp_zip, data_dir)
    if temp_zip.exists():
        try:
            temp_zip.unlink()
        except Exception:
            pass

    if not extract_success:
        return False

    # 5. Kiểm tra lần cuối
    is_ready, final_reason = check_dataset_ready(data_dir)
    if is_ready:
        print(f"\n🎉 HOÀN TẤT CHUẨN BỊ DỮ LIỆU: {final_reason}")
        print("=" * 80 + "\n")
        return True
    else:
        print(f"❌ Dữ liệu sau giải nén chưa hoàn chỉnh: {final_reason}")
        return False


# ========================================================================================
# HTTP REQUEST HANDLER
# ========================================================================================

class ReviewAPIHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Chỉ phục vụ static files từ trong thư mục EVALUATION_DIR (evaluation/)
        super().__init__(*args, directory=str(EVALUATION_DIR), **kwargs)

    def translate_path(self, path):
        # Chuẩn hóa đường dẫn tương đối trong evaluation/
        path = path.split("?", 1)[0]
        path = path.split("#", 1)[0]

        # Bỏ tiền tố /evaluation/ nếu có để map đúng vào thư mục EVALUATION_DIR
        if path.startswith("/evaluation/"):
            path = path[len("/evaluation"):]
        elif path == "/evaluation":
            path = "/"

        # Nếu request gọi trực tiếp /data/... -> chuyển thành /image-experiment/data/...
        if path.startswith("/data/"):
            path = "/image-experiment" + path

        return super().translate_path(path)

    def do_GET(self):
        parsed = urlparse(self.path)
        
        # Redirect root to review UI
        if parsed.path in ["/", "/index.html"]:
            self.send_response(302)
            self.send_header("Location", "/image-experiment/human_review_ui.html")
            self.end_headers()
            return

        # Redirect /quick-translate to quick translation UI
        if parsed.path in ["/quick-translate", "/quick-translate.html", "/quick_translation.html", "/quick_translate"]:
            self.send_response(302)
            self.send_header("Location", "/image-experiment/quick_translation_ui.html")
            self.end_headers()
            return

        req_path = parsed.path.rstrip("/")

        # API: Liệt kê các file liên quan vlm_dataset (tệp chuẩn và bản review cá nhân)
        if req_path == "/api/files" or req_path.endswith("/api/files"):
            files = []
            if DEFAULT_DATASET_FILE.exists():
                size_kb = round(DEFAULT_DATASET_FILE.stat().st_size / 1024, 1)
                files.append({
                    "name": DEFAULT_DATASET_NAME,
                    "path": f"image-experiment/data/{DEFAULT_DATASET_NAME}",
                    "size_kb": size_kb,
                    "modified": datetime.fromtimestamp(DEFAULT_DATASET_FILE.stat().st_mtime).strftime("%d/%m/%Y %H:%M"),
                    "is_protected": True,
                    "is_review": False
                })

            if DATA_DIR.exists():
                for p in sorted(DATA_DIR.glob("vlm_dataset_review_*.json")):
                    if p.name.endswith(".tmp") or p.name.endswith(".bak"):
                        continue
                    size_kb = round(p.stat().st_size / 1024, 1)
                    file_info = {
                        "name": p.name,
                        "path": f"image-experiment/data/{p.name}",
                        "size_kb": size_kb,
                        "modified": datetime.fromtimestamp(p.stat().st_mtime).strftime("%d/%m/%Y %H:%M"),
                        "is_protected": False,
                        "is_review": True
                    }
                    try:
                        with open(p, "r", encoding="utf-8") as f:
                            data_head = json.load(f)
                        if isinstance(data_head, dict) and "reviewer_info" in data_head:
                            r_info = data_head["reviewer_info"]
                            file_info["reviewer_name"] = r_info.get("reviewer_name", "")
                            file_info["reviewed_count"] = r_info.get("reviewed_count", 0)
                            file_info["total_samples"] = r_info.get("total_samples", 0)
                    except Exception:
                        pass
                    files.append(file_info)

            self._send_json({"files": files, "protected_files": list(PROTECTED_BASE_FILES)})
            return

        # API: Nạp nội dung dataset (mặc định vlm_dataset.json hoặc tự động dùng file review của người dùng nếu đã có)
        if req_path == "/api/load" or req_path.endswith("/api/load"):
            query = parse_qs(parsed.query)
            reviewer_name = query.get("reviewer", [""])[0].strip()
            requested_file = query.get("file", [""])[0].strip()

            target_path = None

            # 1. Nếu client chỉ định tệp review cụ thể hợp lệ
            if requested_file and requested_file.startswith("vlm_dataset_review_") and requested_file.endswith(".json"):
                cand = DATA_DIR / Path(requested_file).name
                if cand.exists():
                    target_path = cand

            # 2. Nếu có tên reviewer, tự động kiểm tra xem đã có bản review trước đó chưa
            if not target_path and reviewer_name:
                slug = slugify_name(reviewer_name)
                review_file = DATA_DIR / f"vlm_dataset_review_{slug}.json"
                if review_file.exists():
                    target_path = review_file

            # 3. Mặc định luôn là vlm_dataset.json chuẩn
            if not target_path:
                target_path = DEFAULT_DATASET_FILE

            if not target_path.exists():
                self._send_json({"error": f"Không tìm thấy tệp {target_path.name}"}, status=404)
                return

            try:
                with open(target_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                is_review = "_review_" in target_path.name
                self._send_json({
                    "filename": target_path.name,
                    "is_review": is_review,
                    "source_file": DEFAULT_DATASET_NAME,
                    "data": data
                })
            except Exception as e:
                self._send_json({"error": f"Lỗi đọc file {target_path.name}: {str(e)}"}, status=500)
            return

        # Fallback to default static file handler
        return super().do_GET()

    def end_headers(self):
        # Tránh trình duyệt cache HTML/JS/API gây lưu giữ phiên bản cũ
        if self.path.endswith(".html") or self.path.endswith(".js") or "/api/" in self.path:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        req_path = parsed.path.rstrip("/")

        # API: Lưu dữ liệu thẩm định vào đĩa (luôn lưu vào tệp review cá nhân của reviewer)
        if req_path == "/api/save" or req_path.endswith("/api/save"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(body)

                reviewer_name = payload.get("reviewer_name", "").strip() or "reviewer"
                slug = slugify_name(reviewer_name)
                target_filename = f"vlm_dataset_review_{slug}.json"
                source_file = DEFAULT_DATASET_NAME
                samples = payload.get("samples", [])

                target_path = DATA_DIR / target_filename

                # Tuyệt đối không cho phép ghi đè file chuẩn chung
                if target_path.name in PROTECTED_BASE_FILES:
                    self._send_json({
                        "error": f"Tệp '{target_path.name}' là tệp gốc dùng chung. Vui lòng lưu vào tệp review cá nhân ({target_filename})!"
                    }, status=403)
                    return

                # Đếm số lượng đã review
                reviewed_count = sum(1 for s in samples if s.get("human_review", {}).get("reviewed", False))

                output_data = {
                    "reviewer_info": {
                        "reviewer_name": reviewer_name,
                        "source_file": source_file,
                        "last_saved_at": datetime.now().isoformat(),
                        "reviewed_count": reviewed_count,
                        "total_samples": len(samples)
                    },
                    "samples": samples
                }

                # Lưu an toàn vào đĩa (atomic write)
                temp_path = target_path.with_suffix(".tmp")
                with open(temp_path, "w", encoding="utf-8") as f:
                    json.dump(output_data, f, ensure_ascii=False, indent=2)
                
                temp_path.replace(target_path)

                self._send_json({
                    "success": True,
                    "saved_file": target_filename,
                    "message": f"Đã lưu thành công vào {target_filename}",
                    "reviewed_count": output_data["reviewer_info"]["reviewed_count"],
                    "total_samples": output_data["reviewer_info"]["total_samples"]
                })
            except Exception as e:
                self._send_json({"error": f"Lỗi lưu file: {str(e)}"}, status=500)
            return

        # API: Cập nhật bản dịch text_vi vào cả vlm_dataset.json và các file review
        if req_path == "/api/update_translation" or req_path.endswith("/api/update_translation"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(body)

                sample_id = payload.get("id", "").strip()
                new_text_vi = payload.get("text_vi", "").strip()

                if not sample_id:
                    self._send_json({"error": "Thiếu sample id"}, status=400)
                    return

                updated_files = []

                # 1. Cập nhật vlm_dataset.json
                vlm_path = DATA_DIR / "vlm_dataset.json"
                if vlm_path.exists():
                    with open(vlm_path, "r", encoding="utf-8") as f:
                        vlm_data = json.load(f)
                    found = False
                    if isinstance(vlm_data, list):
                        for s in vlm_data:
                            if s.get("id") == sample_id:
                                s["text_vi"] = new_text_vi
                                found = True
                                break
                    elif isinstance(vlm_data, dict) and "samples" in vlm_data:
                        for s in vlm_data["samples"]:
                            if s.get("id") == sample_id:
                                s["text_vi"] = new_text_vi
                                found = True
                                break
                    if found:
                        temp_path = vlm_path.with_suffix(".tmp")
                        with open(temp_path, "w", encoding="utf-8") as f:
                            json.dump(vlm_data, f, ensure_ascii=False, indent=2)
                        temp_path.replace(vlm_path)
                        updated_files.append("vlm_dataset.json")

                # 2. Cập nhật tất cả các file review (như vlm_dataset_review_huy_le.json)
                for rev_path in DATA_DIR.glob("vlm_dataset_review_*.json"):
                    if rev_path.name.endswith(".tmp") or rev_path.name.endswith(".bak"):
                        continue
                    try:
                        with open(rev_path, "r", encoding="utf-8") as f:
                            rev_data = json.load(f)
                        found = False
                        if isinstance(rev_data, dict) and "samples" in rev_data:
                            for s in rev_data["samples"]:
                                if s.get("id") == sample_id:
                                    s["text_vi"] = new_text_vi
                                    found = True
                                    break
                            if found:
                                if "reviewer_info" in rev_data:
                                    rev_data["reviewer_info"]["last_saved_at"] = datetime.now().isoformat()
                                temp_path = rev_path.with_suffix(".tmp")
                                with open(temp_path, "w", encoding="utf-8") as f:
                                    json.dump(rev_data, f, ensure_ascii=False, indent=2)
                                temp_path.replace(rev_path)
                                updated_files.append(rev_path.name)
                    except Exception as e:
                        print(f"Lỗi khi cập nhật {rev_path.name}: {e}")

                self._send_json({
                    "success": True,
                    "id": sample_id,
                    "text_vi": new_text_vi,
                    "updated_files": updated_files
                })
            except Exception as e:
                self._send_json({"error": f"Lỗi cập nhật bản dịch: {str(e)}"}, status=500)
            return

        self._send_json({"error": "Not Found"}, status=404)

    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Tắt bớt log request thông thường để console gọn gàng
        if "GET /api/" in format % args or "POST /api/" in format % args:
            sys.stdout.write(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}\n")


def run_server(port: int = DEFAULT_PORT, download_url: str = DEFAULT_ASSETS_URL, force_download: bool = False, no_browser: bool = False):
    # 1. Đảm bảo dữ liệu kiểm thử và ảnh đã sẵn sàng
    if not ensure_dataset_ready(DATA_DIR, download_url=download_url, force=force_download):
        print("\n[STOP] Hủy khởi động máy chủ do thiếu dữ liệu.")
        sys.exit(1)

    # 2. Khởi động HTTP Server
    server_address = ("", port)
    httpd = HTTPServer(server_address, ReviewAPIHandler)
    url = f"http://localhost:{port}/image-experiment/human_review_ui.html"

    print("=" * 80)
    print("  🚀 MÁY CHỦ THẨM ĐỊNH DỮ LIỆU ĐA PHƯƠNG THỨC (HUMAN-IN-THE-LOOP SERVER)")
    print("=" * 80)
    print(f"  • Địa chỉ truy cập: {url}")
    print(f"  • Thư mục dữ liệu:  {DATA_DIR}")
    if not no_browser:
        print("  • Tự động mở trình duyệt web...")
    print("  • Bấm Ctrl+C để dừng máy chủ bất kỳ lúc nào.")
    print("=" * 80 + "\n")

    if not no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[OK] Đã dừng máy chủ thành công.")
        httpd.server_close()


def main():
    parser = argparse.ArgumentParser(description="Chạy máy chủ cục bộ thẩm định VLM Benchmark (SE121)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Cổng chạy server (mặc định: 8080)")
    parser.add_argument("--download-url", type=str, default=DEFAULT_ASSETS_URL, help="URL tải trực tiếp gói dữ liệu benchmark vlm_benchmark_assets.zip")
    parser.add_argument("--force-download", action="store_true", help="Bắt buộc tải lại dữ liệu dù đã có trên máy")
    parser.add_argument("--no-browser", action="store_true", help="Không tự động mở trình duyệt web khi bật server")

    args = parser.parse_args()
    run_server(port=args.port, download_url=args.download_url, force_download=args.force_download, no_browser=args.no_browser)


if __name__ == "__main__":
    main()
