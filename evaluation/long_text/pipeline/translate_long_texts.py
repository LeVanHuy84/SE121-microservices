import json
import logging
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

from playwright.sync_api import sync_playwright

# Ensure UTF-8 output encoding on Windows console
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

# Underthesea for sentence counting
try:
    from underthesea import sent_tokenize
    HAS_UNDERTHESEA = True
except ImportError:
    HAS_UNDERTHESEA = False

COMMON_VIETNAMESE_NAMES = [
    "Nam", "Linh", "Hùng", "Hương", "Tuấn", "Mai", "Hoàng", "Trang", 
    "Phong", "Đạt", "Lan", "Huy", "Thảo", "Dũng", "Ngọc", "Anh", 
    "Quang", "Phương", "Minh", "Hà", "Đức", "Thành", "Khánh", "Hải",
    "Yến", "Thúy", "Bình", "Vũ", "Sơn", "Long"
]

DELIMITER = " ||| "


def fix_punctuation_spacing(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"^(?:Translation results|Kết quả dịch)\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[♪♫🎵🎶]", "", text)
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    text = re.sub(r"/\s+s\b", "/s", text)
    return " ".join(text.split()).strip()


def save_checkpoint(output_file: Path, items: List[Dict[str, Any]]):
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def clear_and_fill_textarea(page, text: str):
    textarea = page.locator("textarea").first
    textarea.click()
    page.keyboard.press("Control+A")
    page.keyboard.press("Backspace")
    time.sleep(0.15)
    textarea.fill(text)


def translate_single_on_page(page, text: str, max_wait_sec: float = 25.0) -> str:
    """Dịch 1 câu đơn lẻ với cơ chế chờ ổn định và kiểm tra hợp lệ."""
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
            cleaned = re.sub(r"^(?:Translation results|Kết quả dịch)\s*", "", raw_val, flags=re.IGNORECASE).strip()
            cleaned = re.sub(r"[♪♫🎵🎶]", "", cleaned).strip()

            if cleaned and cleaned.lower() != text.lower() and len(cleaned) > 2:
                if cleaned == last_val:
                    stable_count += 1
                    if stable_count >= 2:  # Giữ ổn định trong ~0.8s
                        return cleaned
                else:
                    last_val = cleaned
                    stable_count = 0

        if last_val and last_val.lower() != text.lower():
            return last_val
    except Exception as e:
        logger.warning(f"Lỗi khi dịch câu đơn: {e}")
    return ""


def try_translate_batch(page, batch_texts: List[str], max_wait_sec: float = 25.0) -> List[str]:
    """Thử dịch cả batch bằng cách ghép delimiter ' ||| '. Trả về list nếu khớp số dòng, ngược lại trả về []."""
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


def run_playwright_long_translation(batch_size: int = 5, headless: bool = False, custom_profile_dir: str = None):
    """
    Translate 300 long GoEmotions comments to natural Vietnamese using Playwright & Google Translate Web.
    Features:
      - Uses persistent profile in evaluation/chrome_profile (or custom_profile_dir)
      - Batches by 5 items with delimiter ' ||| '
      - Dynamic waiting & element parsing
      - Replaces [NAME] with natural Vietnamese names
      - Saves checkpoint after every batch
    """
    root_dir = Path(__file__).resolve().parent.parent
    data_dir = root_dir / "data"
    if custom_profile_dir:
        profile_dir = Path(custom_profile_dir).resolve()
    else:
        profile_dir = root_dir.parent / "chrome_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    input_file = data_dir / "goemotions_long_en.json"
    output_file = data_dir / "long_text_benchmark_300.json"

    if not input_file.exists():
        logger.error(f"{input_file} không tìm thấy. Vui lòng chạy extract_long_goemotions.py trước!")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)

    total_samples = len(extracted_data)
    logger.info(f"Đã nạp {total_samples} mẫu bình luận dài tiếng Anh từ {input_file.name}.")

    # Check for existing checkpoint to support seamless resume
    existing_map: Dict[str, dict] = {}
    if output_file.exists():
        try:
            with open(output_file, "r", encoding="utf-8") as f:
                old_items = json.load(f)
                for it in old_items:
                    orig = it.get("original_english")
                    txt = it.get("text")
                    # Chỉ chấp nhận mẫu đã có bản dịch tiếng Việt thực sự
                    if orig and txt and txt.strip().lower() != orig.strip().lower():
                        existing_map[orig] = it
            logger.info(f"[RESUME] Tìm thấy {len(existing_map)} mẫu đã dịch tiếng Việt hợp lệ trong checkpoint.")
        except Exception as e:
            logger.warning(f"Lỗi đọc file checkpoint cũ: {e}. Sẽ tiến hành dịch mới.")

    translated_results: List[dict] = [existing_map[it["original_english"]] for it in extracted_data if it["original_english"] in existing_map]
    untranslated_items = [it for it in extracted_data if it["original_english"] not in existing_map]

    logger.info(f"Đã hoàn thành: {len(translated_results)}/{total_samples} | Còn lại cần dịch: {len(untranslated_items)}")

    if not untranslated_items:
        logger.info(f"Tất cả {total_samples} mẫu đều đã được dịch hoàn chỉnh!")
        return

    total_batches = (len(untranslated_items) + batch_size - 1) // batch_size

    with sync_playwright() as p:
        logger.info(f"Khởi động Real Chrome với Profile: {profile_dir} (headless={headless})...")
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir.resolve()),
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
                user_data_dir=str(profile_dir.resolve()),
                headless=headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-infobars"
                ]
            )

        page = context.pages[0] if context.pages else context.new_page()

        # Stealth injection: remove webdriver detection
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.navigator.chrome = {
                runtime: {}
            };
        """)

        logger.info("Đang điều hướng đến Google Translate Web (En -> Vi)...")
        page.goto("https://translate.google.com/?sl=en&tl=vi&op=translate")
        time.sleep(2)

        # Tự động đóng popup đồng ý cookie (nếu có trên lần đầu mở profile)
        for consent_text in ["Accept all", "Chấp nhận tất cả", "Tôi đồng ý", "I agree", "Reject all", "Từ chối tất cả"]:
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
            
            batch_english_texts = []
            for item in batch_items:
                clean_eng = item["original_english"].replace("\n", " ").strip()
                clean_eng = re.sub(r"\[NAME\]", "[TÊN]", clean_eng, flags=re.IGNORECASE)
                batch_english_texts.append(clean_eng)

            # 1. Thử dịch cả batch trước (nhanh hơn nếu Google không nuốt delimiter)
            translated_lines = try_translate_batch(page, batch_english_texts, max_wait_sec=25.0)

            # 2. Nếu batch không khớp hoặc Google nuốt delimiter:
            # TỰ ĐỘNG CHUYỂN SANG DỊCH TỪNG CÂU ĐƠN LẺ CHO BATCH NÀY (ĐẢM BẢO 100% CHÍNH XÁC)
            if len(translated_lines) != len(batch_items):
                logger.warning(
                    f"  [Batch {b_idx + 1}/{total_batches}] Batch mismatch/nuốt delimiter "
                    f"({len(translated_lines)}/{len(batch_items)}). Tự động chuyển sang dịch tách từng câu..."
                )
                translated_lines = []
                for s_idx, eng_s in enumerate(batch_english_texts):
                    vi_single = translate_single_on_page(page, eng_s, max_wait_sec=25.0)
                    if not vi_single or vi_single.strip().lower() == eng_s.strip().lower():
                        # Thử reload trang và dịch lại nếu web bị đơ
                        logger.warning(f"    • Đang tải lại trang để thử lại câu {s_idx + 1}...")
                        page.reload()
                        page.wait_for_selector("textarea", timeout=30000)
                        time.sleep(1)
                        vi_single = translate_single_on_page(page, eng_s, max_wait_sec=25.0)

                    translated_lines.append(vi_single)
                    time.sleep(0.3)

            # 3. Xử lý và kiểm tra từng item: TUYỆT ĐỐI KHÔNG LƯU NẾU CHƯA DỊCH
            batch_saved = 0
            for i, item in enumerate(batch_items):
                eng_text = item["original_english"]
                vi_translated = translated_lines[i] if i < len(translated_lines) else ""

                # Nếu câu dịch rỗng hoặc còn giữ nguyên tiếng Anh -> BỎ QUA, KHÔNG LƯU!
                if not vi_translated or vi_translated.strip().lower() == eng_text.strip().lower():
                    logger.error(f"❌ CHƯA DỊCH ĐƯỢC mẫu {item['id']}: '{eng_text[:40]}...'. Bỏ qua để thử lại lần sau!")
                    continue

                vi_translated = fix_punctuation_spacing(vi_translated)

                # Thay thế placeholder tên người Việt tự nhiên
                if "[TÊN]" in vi_translated or "[NAME]" in vi_translated:
                    random_name = random.choice(COMMON_VIETNAMESE_NAMES)
                    vi_translated = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", random_name, vi_translated, flags=re.IGNORECASE)

                if HAS_UNDERTHESEA:
                    sents = sent_tokenize(vi_translated)
                else:
                    sents = [s.strip() for s in re.split(r'[.!?]+', vi_translated) if len(s.strip()) > 0]

                res_item = dict(item)
                res_item["text"] = vi_translated
                res_item["word_count"] = len(vi_translated.split())
                res_item["sentence_count"] = len(sents)
                res_item["source"] = "Google-Translate-Playwright-RealChrome"
                translated_results.append(res_item)
                existing_map[eng_text] = res_item
                batch_saved += 1

            if batch_saved > 0:
                save_checkpoint(output_file, translated_results)
            
            elapsed = time.time() - start_time
            done_count = len(translated_results)
            rate = (done_count - (total_samples - len(untranslated_items))) / max(elapsed, 1)
            remaining_samples = total_samples - done_count
            eta_sec = remaining_samples / max(rate, 0.01)

            logger.info(
                f"[{done_count}/{total_samples}] ({(done_count/total_samples)*100:.1f}%) "
                f"Batch {b_idx + 1}/{total_batches} xong (+{batch_saved} câu) | "
                f"Đã chạy: {elapsed/60:.1f}m | Còn lại: {eta_sec/60:.1f}m"
            )

            time.sleep(random.uniform(0.6, 1.2))

        context.close()

    logger.info("HOÀN THÀNH! Dịch Google Translate Playwright thành công.")
    logger.info(f"Đã lưu {len(translated_results)} mẫu vào {output_file}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Dịch GoEmotions dài sang tiếng Việt chất lượng cao bằng Playwright + Google Translate Web.")
    parser.add_argument("--batch-size", type=int, default=5, help="Số lượng mẫu gộp mỗi batch (mặc định: 5)")
    parser.add_argument("--headless", action="store_true", help="Chạy ở chế độ không hiện cửa sổ Chrome (headless)")
    parser.add_argument("--profile-dir", type=str, default=None, help="Đường dẫn đến thư mục Profile Chrome (mặc định: evaluation/chrome_profile)")
    cli_args = parser.parse_args()

    run_playwright_long_translation(
        batch_size=cli_args.batch_size,
        headless=cli_args.headless,
        custom_profile_dir=cli_args.profile_dir
    )
