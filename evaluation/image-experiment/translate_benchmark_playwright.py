"""
========================================================================================
TRANSLATE 1,000 BENCHMARK SAMPLES USING PLAYWRIGHT & GOOGLE TRANSLATE WEB
========================================================================================
Dự án: SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)
Mục đích:
  Dịch 1.000 câu status/tweet tiếng Anh trong tập Benchmark sang tiếng Việt
  bằng Playwright chạy Real Chrome Profile trên Google Translate Web.

Đặc điểm kế thừa từ pipeline chuẩn (translate_long_texts.py):
  - Dùng Chrome Profile tại evaluation/chrome_profile (lưu cache & cookie ổn định).
  - Dịch batch 5 câu với phân cách ' ||| ' để tăng tốc độ.
  - Tự động chuyển sang dịch từng câu đơn nếu Google Translate nuốt dấu phân cách.
  - Lưu checkpoint liên tục sau mỗi batch (hỗ trợ dừng/tiếp tục mượt mà).

Cách chạy:
  evaluation\\.venv\\Scripts\\python.exe evaluation\\image-experiment\\translate_benchmark_playwright.py
========================================================================================
"""

import os
import re
import sys
import json
import time
import random
import logging
import argparse
from pathlib import Path
from typing import List, Dict, Any

from playwright.sync_api import sync_playwright

# Ensure UTF-8 output on Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
BENCHMARK_FILE = DATA_DIR / "vlm_dataset.json"
CHROME_PROFILE_DIR = BASE_DIR.parent / "chrome_profile"

DELIMITER = " ||| "


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def fix_punctuation_spacing(text: str) -> str:
    """Làm sạch tiền tố, khoảng trắng và dấu câu thừa trong bản dịch."""
    if not text:
        return ""
    text = re.sub(r"^(?:Translation results|Kết quả dịch)\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[♪♫🎵🎶]", "", text)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    return " ".join(text.split()).strip()


def clear_and_fill_textarea(page, text: str):
    """Xóa trắng ô input và điền text mới."""
    textarea = page.locator("textarea").first
    textarea.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Backspace")
    time.sleep(0.15)
    textarea.fill(text)


def translate_single_on_page(page, text: str, max_wait_sec: float = 25.0) -> str:
    """Dịch 1 câu đơn lẻ với cơ chế chờ ổn định kết quả."""
    try:
        clear_and_fill_textarea(page, text)
        start_t = time.time()
        last_val = ""
        stable_count = 0

        while time.time() - start_t < max_wait_sec:
            time.sleep(0.4)
            raw_val = page.evaluate("""() => {
                const els = document.querySelectorAll('span[jsname="W2wUfc"]');
                if (els && els.length > 0) {
                    return Array.from(els).map(e => e.innerText).join(' ').trim();
                }
                const container = document.querySelector('c-wiz[role="region"]');
                return container ? container.innerText : '';
            }""")
            cleaned = fix_punctuation_spacing(raw_val)

            # Nếu chưa dịch xong (đang hiện "Translating..." hoặc "Đang dịch...") thì chờ thêm
            if any(p in cleaned.lower() for p in ["translating", "đang dịch"]):
                continue

            if cleaned and cleaned.lower() != text.lower() and len(cleaned) > 2:
                if cleaned == last_val:
                    stable_count += 1
                    if stable_count >= 2:  # Ổn định trong ~0.8s
                        return cleaned
                else:
                    last_val = cleaned
                    stable_count = 0

        if last_val and last_val.lower() != text.lower() and not any(p in last_val.lower() for p in ["translating", "đang dịch"]):
            return last_val

    except Exception as e:
        logger.warning(f"Lỗi khi dịch câu đơn: {e}")
    return ""


def try_translate_batch(page, batch_texts: List[str], max_wait_sec: float = 25.0) -> List[str]:
    """Thử dịch cả batch bằng cách ghép delimiter ' ||| '."""
    try:
        combined_prompt = f"\n{DELIMITER}\n".join(batch_texts)
        clear_and_fill_textarea(page, combined_prompt)

        start_t = time.time()
        last_valid_lines = []
        stable_count = 0

        while time.time() - start_t < max_wait_sec:
            time.sleep(0.5)
            raw_val = page.evaluate("""() => {
                const els = document.querySelectorAll('span[jsname="W2wUfc"]');
                if (els && els.length > 0) {
                    return Array.from(els).map(e => e.innerText).join('\\n');
                }
                const container = document.querySelector('c-wiz[role="region"]');
                return container ? container.innerText : '';
            }""")

            translated_lines = [
                t.strip() for t in re.split(r"\s*\|[\s|]*\|\s*|\n\s*\|[\s|]*\|\s*\n", raw_val)
                if t.strip() and not re.match(r"^(?:Translation results|Kết quả dịch)$", t.strip(), re.IGNORECASE)
            ]

            if len(translated_lines) == len(batch_texts):
                # Nếu bất kỳ câu nào trong batch đang ở trạng thái loading thì chờ tiếp
                if any(any(p in tl.lower() for p in ["translating", "đang dịch"]) for tl in translated_lines):
                    continue

                has_untranslated = any(
                    tl.lower() == bt.lower() for tl, bt in zip(translated_lines, batch_texts)
                )
                if not has_untranslated:

                    if translated_lines == last_valid_lines:
                        stable_count += 1
                        if stable_count >= 2:
                            return translated_lines
                    else:
                        last_valid_lines = translated_lines
                        stable_count = 0
            else:
                stable_count = 0

        if len(last_valid_lines) == len(batch_texts):
            return last_valid_lines
    except Exception as e:
        logger.warning(f"Lỗi khi thử dịch batch: {e}")
    return []


# ============================================================================
# MAIN TRANSLATION RUNNER
# ============================================================================

def run_translation(batch_size: int = 5, headless: bool = False):
    if not BENCHMARK_FILE.exists():
        logger.error(f"Không tìm thấy file: {BENCHMARK_FILE}. Vui lòng chạy curate_candidate_1000_pool.py trước!")
        return

    with open(BENCHMARK_FILE, "r", encoding="utf-8") as f:
        samples = json.load(f)

    total_samples = len(samples)
    samples_map = {it["id"]: it for it in samples}

    # Tìm những câu chưa có bản dịch tiếng Việt hợp lệ (bao gồm câu bị dính chữ loading chưa dịch xong)
    untranslated_items = [
        it for it in samples
        if not it.get("text_vi") or it.get("text_vi").strip() == "" 
        or it.get("text_vi").strip().lower() == it.get("text").strip().lower()
        or any(p in it.get("text_vi").lower() for p in ["translating", "đang dịch"])
    ]
    done_count = total_samples - len(untranslated_items)


    logger.info("=" * 80)
    logger.info("  PLAYWRIGHT GOOGLE TRANSLATE PIPELINE — 1.000 MẪU BENCHMARK")
    logger.info("=" * 80)
    logger.info(f"  • File Benchmark:    {BENCHMARK_FILE}")
    logger.info(f"  • Chrome Profile:    {CHROME_PROFILE_DIR}")
    logger.info(f"  • Tổng số mẫu:       {total_samples}")
    logger.info(f"  • Đã hoàn thành:     {done_count}/{total_samples} mẫu")
    logger.info(f"  • Cần dịch tiếp:     {len(untranslated_items)} mẫu")
    logger.info("=" * 80)

    if not untranslated_items:
        logger.info("🎉 Tất cả 1.000 mẫu đều đã có bản dịch tiếng Việt hoàn chỉnh!")
        return

    CHROME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    total_batches = (len(untranslated_items) + batch_size - 1) // batch_size

    with sync_playwright() as p:
        logger.info(f"Khởi động Chrome thật với Profile: {CHROME_PROFILE_DIR} (headless={headless})...")
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(CHROME_PROFILE_DIR.resolve()),
                channel="chrome",
                headless=headless,
                no_viewport=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars",
                    "--start-maximized",
                    "--no-first-run",
                    "--no-default-browser-check"
                ]
            )
        except Exception as e:
            logger.warning(f"Không thể mở kênh 'chrome': {e}. Chuyển sang mặc định chromium persistent...")
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(CHROME_PROFILE_DIR.resolve()),
                headless=headless,
                args=["--disable-blink-features=AutomationControlled", "--disable-infobars"]
            )

        page = context.pages[0] if context.pages else context.new_page()

        # Stealth injection
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.navigator.chrome = { runtime: {} };
        """)

        logger.info("Đang điều hướng đến Google Translate Web (En -> Vi)...")
        page.goto("https://translate.google.com/?sl=en&tl=vi&op=translate")
        time.sleep(2)

        # Đóng popup cookie nếu có
        for consent_text in ["Accept all", "Chấp nhận tất cả", "Tôi đồng ý", "I agree"]:
            try:
                btn = page.locator(f"button:has-text('{consent_text}')")
                if btn.count() > 0 and btn.first.is_visible():
                    btn.first.click()
                    time.sleep(1)
                    break
            except Exception:
                pass

        page.wait_for_selector("textarea", timeout=30000)
        time.sleep(1)

        start_time = time.time()

        for b_idx in range(total_batches):
            batch_items = untranslated_items[b_idx * batch_size : (b_idx + 1) * batch_size]
            batch_english_texts = [it["text"].replace("\n", " ").strip() for it in batch_items]

            # 1. Thử dịch cả batch trước (nhanh hơn)
            translated_lines = try_translate_batch(page, batch_english_texts, max_wait_sec=25.0)

            # 2. Nếu batch không khớp: Chuyển sang dịch từng câu đơn
            if len(translated_lines) != len(batch_items):
                logger.warning(
                    f"  [Batch {b_idx + 1}/{total_batches}] Batch mismatch/nuốt delimiter "
                    f"({len(translated_lines)}/{len(batch_items)}). Chuyển sang dịch tách từng câu..."
                )
                translated_lines = []
                for s_idx, eng_s in enumerate(batch_english_texts):
                    vi_single = translate_single_on_page(page, eng_s, max_wait_sec=25.0)
                    if not vi_single or vi_single.strip().lower() == eng_s.strip().lower():
                        logger.warning(f"    • Đang tải lại trang để thử lại câu {s_idx + 1}...")
                        page.reload()
                        page.wait_for_selector("textarea", timeout=30000)
                        time.sleep(1)
                        vi_single = translate_single_on_page(page, eng_s, max_wait_sec=25.0)

                    translated_lines.append(vi_single)
                    time.sleep(0.3)

            # 3. Cập nhật và kiểm tra từng item
            batch_saved = 0
            for i, item in enumerate(batch_items):
                eng_text = item["text"]
                vi_translated = translated_lines[i] if i < len(translated_lines) else ""

                if (
                    not vi_translated
                    or vi_translated.strip().lower() == eng_text.strip().lower()
                    or any(p in vi_translated.lower() for p in ["translating", "đang dịch"])
                ):
                    logger.error(f"❌ CHƯA DỊCH ĐƯỢC mẫu {item['id']}: '{eng_text[:40]}...'. Bỏ qua để thử lại sau!")
                    continue


                vi_translated = fix_punctuation_spacing(vi_translated)
                item["text_vi"] = vi_translated
                samples_map[item["id"]]["text_vi"] = vi_translated
                batch_saved += 1

            # Lưu checkpoint ngay sau batch
            if batch_saved > 0:
                with open(BENCHMARK_FILE, "w", encoding="utf-8") as f:
                    json.dump(samples, f, ensure_ascii=False, indent=2)

            elapsed = time.time() - start_time
            curr_done = total_samples - len(untranslated_items) + (b_idx + 1) * batch_size
            curr_done = min(curr_done, total_samples)
            pct = (curr_done / total_samples) * 100

            logger.info(
                f"[{curr_done}/{total_samples}] ({pct:.1f}%) "
                f"Batch {b_idx + 1}/{total_batches} xong (+{batch_saved} câu) | "
                f"Đã chạy: {elapsed/60:.1f}m"
            )

        logger.info("\n" + "=" * 80)
        logger.info("🎉 HOÀN TẤT DỊCH TOÀN BỘ 1.000 MẪU BENCHMARK!")
        logger.info(f"File lưu trữ chính thức: {BENCHMARK_FILE}")
        logger.info("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Translate 1,000 Benchmark samples using Google Translate Web")
    parser.add_argument("--batch-size", type=int, default=5, help="Số lượng mẫu mỗi batch (mặc định: 5)")
    parser.add_argument("--headless", action="store_true", help="Chạy ẩn (Headless). Mặc định False để bạn xem trực quan")
    args = parser.parse_args()

    run_translation(batch_size=args.batch_size, headless=args.headless)
