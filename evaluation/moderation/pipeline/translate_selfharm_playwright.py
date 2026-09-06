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
    "Quang", "Phương", "Minh", "Hà", "Đức", "Thành", "Khánh", "Hải"
]

CATEGORY_TO_LABEL_ID = {
    "SELF_HARM_EXPLICIT": 3,
    "DEPRESSION_VENTING": 3,
    "CLEAN": 0
}

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
    return text.strip()


def save_checkpoint(output_file: Path, items: List[Dict[str, Any]]):
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def run_playwright_google_translation():
    data_dir = Path(__file__).parent.parent / "data"
    input_file = data_dir / "extracted_english_selfharm.json"
    output_file = data_dir / "selfharm_vietnamese_augmented.json"

    if not input_file.exists():
        logger.error(f"{input_file} not found. Run extract_english_selfharm.py first!")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)

    logger.info(f"Loaded {len(extracted_data)} extracted English samples for Playwright Google Web Translation...")

    existing_map: Dict[str, dict] = {}
    augmented_results: List[dict] = []

    # Reset file to ensure fresh run from sample 1
    if output_file.exists():
        try:
            output_file.unlink()
        except Exception:
            pass

    pending_items = extracted_data
    logger.info(f"Starting FRESH run from Sample 1. Total samples to translate: {len(pending_items)}")

    BATCH_SIZE = 10  # 10 sentences per batch for clean separation

    with sync_playwright() as p:
        logger.info("Launching Playwright Chromium Browser...")
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800}
        )
        page = context.new_page()

        logger.info("Navigating to Google Translate Web (En -> Vi)...")
        page.goto("https://translate.google.com/?sl=en&tl=vi&op=translate")
        page.wait_for_selector("textarea", timeout=15000)
        time.sleep(2)

        total_batches = (len(pending_items) + BATCH_SIZE - 1) // BATCH_SIZE

        for b_idx in range(total_batches):
            batch_items = pending_items[b_idx * BATCH_SIZE : (b_idx + 1) * BATCH_SIZE]
            
            batch_english_texts = []
            for item in batch_items:
                clean_eng = item["text"].replace("\n", " ").strip()
                clean_eng = re.sub(r"\[NAME\]", "[TÊN]", clean_eng, flags=re.IGNORECASE)
                batch_english_texts.append(clean_eng)

            combined_prompt = f"\n{DELIMITER}\n".join(batch_english_texts)

            # Clear textarea & fill combined prompt
            textarea = page.locator("textarea").first
            textarea.click()
            page.keyboard.press("Control+A")
            page.keyboard.press("Backspace")
            time.sleep(0.3)

            textarea.fill(combined_prompt)

            # Wait for translation output element to update
            time.sleep(3.0)

            # Precise selector for Google Translate output container
            translated_text_raw = page.evaluate("""() => {
                const els = document.querySelectorAll('span[jsname="W2wUfc"]');
                if (els && els.length > 0) {
                    return Array.from(els).map(e => e.innerText).join('\\n');
                }
                const container = document.querySelector('c-wiz[role="region"]');
                return container ? container.innerText : '';
            }""")

            # Split translated output back by delimiter
            translated_lines = [t.strip() for t in re.split(r"\s*\|\|\|\s*|\n\s*\|\|\|\s*\n", translated_text_raw) if t.strip()]

            for i, item in enumerate(batch_items):
                item_id = item["id"]
                eng_text = item["text"]
                cat = item["category"]

                if i < len(translated_lines) and len(translated_lines[i]) > 1:
                    vi_translated = translated_lines[i]
                else:
                    vi_translated = eng_text

                vi_translated = fix_punctuation_spacing(vi_translated)

                if "[TÊN]" in vi_translated or "[NAME]" in vi_translated:
                    random_name = random.choice(COMMON_VIETNAMESE_NAMES)
                    vi_translated = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", random_name, vi_translated, flags=re.IGNORECASE)

                res_item = {
                    "id": item_id,
                    "text": vi_translated,
                    "english_original": eng_text,
                    "category": cat,
                    "label": CATEGORY_TO_LABEL_ID.get(cat, 3),
                    "label_name": "SELF_HARM_CRISIS",
                    "source": "Google-Translate-Playwright-Web"
                }
                augmented_results.append(res_item)
                existing_map[item_id] = res_item

            save_checkpoint(output_file, augmented_results)
            logger.info(f"[{len(augmented_results)}/{len(extracted_data)}] Batch {b_idx+1}/{total_batches} translated & saved.")

            time.sleep(random.uniform(1.0, 1.8))

        browser.close()

    logger.info(f"SUCCESS! Playwright Google Web Translation completed. Saved {len(augmented_results)} samples to {output_file}")


if __name__ == "__main__":
    run_playwright_google_translation()
