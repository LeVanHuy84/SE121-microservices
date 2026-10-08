import os
import sys

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import json
import random
import re
import time
import logging
from pathlib import Path
from typing import List, Dict, Any

from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger(__name__)

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
    # Clean UI artifacts like "Translation results" or "Kết quả dịch"
    text = re.sub(r"^(?:Translation results|Kết quả dịch)\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[♪♫🎵🎶]", "", text)
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    text = re.sub(r"/\s+s\b", "/s", text)
    return text.strip()


def save_checkpoint(output_file: Path, items: List[Dict[str, Any]]):
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def run_playwright_goemotions_translation(batch_size: int = 15, headless: bool = False):
    data_dir = Path(__file__).parent.parent / "data"
    profile_dir = Path(__file__).resolve().parents[2] / "chrome_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    input_file = data_dir / "goemotions_minority_extracted.json"
    output_file = data_dir / "goemotions_vietnamese_augmented.json"
    backup_file = data_dir / "goemotions_vietnamese_augmented_old_llm.json.bak"

    if not input_file.exists():
        logger.error(f"{input_file} not found. Run extract_goemotions.py first!")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)

    logger.info(f"Loaded {len(extracted_data)} extracted GoEmotions samples.")

    # Check for existing translations with RealChrome source for resume support
    existing_map: Dict[str, dict] = {}
    if output_file.exists():
        try:
            with open(output_file, "r", encoding="utf-8") as f:
                old_items = json.load(f)
            
            # Check if existing items were from RealChrome Playwright
            realchrome_items = [
                it for it in old_items 
                if it.get("source") == "Google-Translate-Playwright-RealChrome"
            ]
            
            if len(realchrome_items) == len(old_items) and len(realchrome_items) > 0:
                logger.info(f"Found existing RealChrome checkpoint with {len(realchrome_items)} samples. Resuming...")
                for it in realchrome_items:
                    # Only keep as completed if it was actually translated to Vietnamese
                    if it.get("text") and it.get("text") != it.get("original_english"):
                        existing_map[it["original_english"]] = it
            else:
                # Backup previous dataset if backup doesn't exist
                if not backup_file.exists() and len(old_items) > 0:
                    logger.info(f"Backing up previous dataset to {backup_file}...")
                    with open(backup_file, "w", encoding="utf-8") as bf:
                        json.dump(old_items, bf, ensure_ascii=False, indent=2)
                logger.info("Starting FRESH Google Translate RealChrome run...")
        except Exception as e:
            logger.warning(f"Error reading existing file: {e}. Starting fresh.")

    # Filter items that still need translation (either not translated or fell back to English)
    extracted_eng_set = {item["english_text"]: item for item in extracted_data}
    valid_cached = [
        it for it in existing_map.values()
        if it.get("original_english") in extracted_eng_set
    ]
    augmented_results: List[dict] = valid_cached
    untranslated_items = [
        item for item in extracted_data 
        if item["english_text"] not in existing_map
    ]

    total_samples = len(extracted_data)
    logger.info(f"Reusing from valid cache: {len(augmented_results)} | Remaining to translate: {len(untranslated_items)} / {total_samples}")

    if not untranslated_items:
        logger.info(f"All {total_samples} samples are already cleanly translated by RealChrome!")
        from prepare_merged_dataset import prepare_merged_dataset
        prepare_merged_dataset()
        return

    # Use smaller batch size (5) for remaining items to eliminate any delimiter splitting issue
    if len(untranslated_items) < 200:
        batch_size = 5

    total_batches = (len(untranslated_items) + batch_size - 1) // batch_size

    with sync_playwright() as p:
        logger.info(f"Launching Real Chrome with Persistent Profile: {profile_dir} (headless={headless})...")
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
            logger.warning(f"Failed to launch with channel='chrome': {e}. Falling back to default chromium persistent...")
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

        logger.info("Navigating to Google Translate Web (En -> Vi)...")
        page.goto("https://translate.google.com/?sl=en&tl=vi&op=translate")
        page.wait_for_selector("textarea", timeout=30000)
        time.sleep(2)

        start_time = time.time()

        for b_idx in range(total_batches):
            batch_items = untranslated_items[b_idx * batch_size : (b_idx + 1) * batch_size]
            
            batch_english_texts = []
            for item in batch_items:
                clean_eng = item["english_text"].replace("\n", " ").strip()
                clean_eng = re.sub(r"\[NAME\]", "[TÊN]", clean_eng, flags=re.IGNORECASE)
                batch_english_texts.append(clean_eng)

            combined_prompt = f"\n{DELIMITER}\n".join(batch_english_texts)

            # Clear textarea & fill combined prompt
            textarea = page.locator("textarea").first
            textarea.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            time.sleep(0.2)

            textarea.fill(combined_prompt)

            # Dynamic wait for translation output to fully render
            translated_lines = []
            max_wait_iterations = 25  # up to ~7.5s max
            for _ in range(max_wait_iterations):
                time.sleep(0.3)
                translated_text_raw = page.evaluate("""() => {
                    const els = document.querySelectorAll('span[jsname="W2wUfc"]');
                    if (els && els.length > 0) {
                        return Array.from(els).map(e => e.innerText).join('\\n');
                    }
                    const container = document.querySelector('c-wiz[role="region"]');
                    return container ? container.innerText : '';
                }""")

                # Split by delimiter
                translated_lines = [
                    t.strip() for t in re.split(r"\s*\|[\s|]*\|\s*|\n\s*\|[\s|]*\|\s*\n", translated_text_raw) 
                    if t.strip() and not re.match(r"^(?:Translation results|Kết quả dịch)$", t.strip(), re.IGNORECASE)
                ]

                if len(translated_lines) == len(batch_items):
                    break

            # Process each item in batch
            for i, item in enumerate(batch_items):
                eng_text = item["english_text"]
                label_id = item["target_label"]
                label_name = item["label_name"]

                if i < len(translated_lines) and len(translated_lines[i]) > 1:
                    vi_translated = translated_lines[i]
                else:
                    vi_translated = eng_text
                    logger.warning(f"Batch mismatch: index {i} fallback for: {eng_text[:40]}...")

                vi_translated = fix_punctuation_spacing(vi_translated)

                # Replace [TÊN] with common natural Vietnamese name
                if "[TÊN]" in vi_translated or "[NAME]" in vi_translated:
                    random_name = random.choice(COMMON_VIETNAMESE_NAMES)
                    vi_translated = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", random_name, vi_translated, flags=re.IGNORECASE)

                res_item = {
                    "text": vi_translated,
                    "raw_translated": vi_translated,
                    "original_english": eng_text,
                    "label": label_id,
                    "label_name": label_name,
                    "source": "Google-Translate-Playwright-RealChrome"
                }
                augmented_results.append(res_item)
                existing_map[eng_text] = res_item

            save_checkpoint(output_file, augmented_results)
            
            elapsed = time.time() - start_time
            done_count = len(augmented_results)
            rate = (done_count - (total_samples - len(untranslated_items))) / max(elapsed, 1)
            remaining_samples = total_samples - done_count
            eta_sec = remaining_samples / max(rate, 0.01)

            logger.info(
                f"[{done_count}/{total_samples}] ({(done_count/total_samples)*100:.1f}%) "
                f"Batch {b_idx + 1}/{total_batches} done | "
                f"Elapsed: {elapsed/60:.1f}m | ETA: {eta_sec/60:.1f}m"
            )

            time.sleep(random.uniform(0.6, 1.2))

        context.close()

    logger.info("SUCCESS! Google Translate RealChrome translation completed.")
    logger.info(f"Saved {len(augmented_results)} samples to {output_file}")

    # Automatically re-prepare and split dataset
    try:
        from prepare_merged_dataset import prepare_merged_dataset
        logger.info("\n--- Now automatically running prepare_merged_dataset() ---")
        prepare_merged_dataset()
    except Exception as e:
        logger.error(f"Error running prepare_merged_dataset: {e}")


if __name__ == "__main__":
    run_playwright_goemotions_translation()
