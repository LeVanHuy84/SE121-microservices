"""
========================================================================================
PACKAGE VLM BENCHMARK ASSETS FOR DISTRIBUTION (SE121 KLTN)
========================================================================================
Dự án: SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)
Mục đích:
  Đóng gói toàn bộ tập dữ liệu kiểm thử Đa phương thức chuẩn vàng:
    1. evaluation/image-experiment/data/vlm_dataset.json (600 mẫu tinh hoa)
    2. evaluation/image-experiment/data/images/ (600 hình ảnh bài đăng)
  thành 1 tệp nén duy nhất:
    evaluation/image-experiment/vlm_benchmark_assets.zip (~37 MB)

Cách sử dụng:
  evaluation\\.venv\\Scripts\\python.exe evaluation\\image-experiment\\package_assets.py
========================================================================================
"""

import os
import sys
import json
import zipfile
from pathlib import Path

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
JSON_FILE = DATA_DIR / "vlm_dataset.json"
IMAGES_DIR = DATA_DIR / "images"
OUTPUT_ZIP = BASE_DIR / "vlm_benchmark_assets.zip"


def package_assets():
    print("=" * 70)
    print("📦 BẮT ĐẦU ĐÓNG GÓI BỘ DỮ LIỆU BENCHMARK VLM (37 MB)")
    print("=" * 70)

    # 1. Kiểm tra file JSON
    if not JSON_FILE.exists():
        print(f"❌ LỖI: Không tìm thấy tệp {JSON_FILE}")
        return False

    with open(JSON_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"✓ Đã nạp {len(data)} mẫu kiểm thử từ {JSON_FILE.name}")

    # 2. Kiểm tra thư mục ảnh
    if not IMAGES_DIR.exists():
        print(f"❌ LỖI: Thư mục {IMAGES_DIR} không tồn tại!")
        return False

    img_files = [f for f in os.listdir(IMAGES_DIR) if os.path.isfile(IMAGES_DIR / f)]
    print(f"✓ Tìm thấy {len(img_files)} tệp hình ảnh trong thư mục images/")

    if len(img_files) < len(data):
        print(f"⚠️ CẢNH BÁO: Số lượng ảnh ({len(img_files)}) ít hơn số mẫu ({len(data)})!")

    # 3. Tạo file ZIP nén Deflate
    print(f"\n🔄 Đang nén tệp vào {OUTPUT_ZIP.name}...")
    with zipfile.ZipFile(OUTPUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zipf:
        # Ghi vlm_dataset.json vào gốc zip
        zipf.write(JSON_FILE, arcname="vlm_dataset.json")

        # Ghi toàn bộ thư mục images/ vào images/ trong zip
        count = 0
        for root, _, files in os.walk(IMAGES_DIR):
            for file in files:
                file_path = Path(root) / file
                rel_path = file_path.relative_to(DATA_DIR)
                zipf.write(file_path, arcname=str(rel_path).replace("\\", "/"))
                count += 1
                if count % 100 == 0 or count == len(img_files):
                    sys.stdout.write(f"\r  -> Đã nén: {count}/{len(img_files)} ảnh...")
                    sys.stdout.flush()

    zip_size_mb = OUTPUT_ZIP.stat().st_size / (1024 * 1024)
    print(f"\n\n🎉 ĐÓNG GÓI THÀNH CÔNG!")
    print(f"📍 Đường dẫn tệp: {OUTPUT_ZIP}")
    print(f"📊 Dung lượng tệp nén: {zip_size_mb:.2f} MB")
    print("=" * 70)
    print("\n👉 BƯỚC TIẾP THEO ĐỂ CHIA SẺ:")
    print("1. Tải tệp 'vlm_benchmark_assets.zip' này lên một trong các nơi sau:")
    print("   • GitHub Releases (Khuyên dùng): Vào repo GitHub -> Releases -> Draft new release -> Đính kèm tệp zip.")
    print("   • Hugging Face Datasets: Tạo dataset repo trên huggingface.co và kéo thả tệp zip lên.")
    print("   • Google Drive: Tải lên Drive và lấy link chia sẻ công khai (Anyone with link can view).")
    print("2. Lấy đường dẫn tải trực tiếp (Direct Download Link) và cấu hình vào `review_server.py`.")
    print("=" * 70)
    return True


if __name__ == "__main__":
    package_assets()
