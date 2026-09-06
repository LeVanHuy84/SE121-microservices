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
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List, Dict, Any

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

# User agents to rotate and prevent IP flagging
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
]


def fix_punctuation_spacing(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"[♪♫🎵🎶]", "", text)
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    return text.strip()


def translate_google_gtx(text: str, retries: int = 4) -> str:
    """
    Translate English to Vietnamese using Google Translate GTX endpoint.
    Handles placeholders and protects formatting.
    """
    if not text or not text.strip():
        return ""

    # Protect placeholders like [NAME]
    protected_text = re.sub(r"\[NAME\]", "___NAME___", text, flags=re.IGNORECASE)
    protected_text = re.sub(r"\[TÊN\]", "___NAME___", protected_text, flags=re.IGNORECASE)

    encoded_text = urllib.parse.quote(protected_text)
    url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=vi&dt=t&q={encoded_text}"

    for attempt in range(retries):
        try:
            headers = {"User-Agent": random.choice(USER_AGENTS)}
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
                
                # Reconstruct translated string from Google segments
                translated_parts = []
                if result and isinstance(result[0], list):
                    for part in result[0]:
                        if part and isinstance(part, list) and len(part) > 0 and part[0]:
                            translated_parts.append(part[0])

                translated_str = "".join(translated_parts).strip()

                # Restore placeholder
                translated_str = re.sub(r"___NAME___|___ NAME ___", "[TÊN]", translated_str)
                translated_str = fix_punctuation_spacing(translated_str)
                return translated_str
        except Exception as e:
            # Exponential backoff on rate limit or network error
            wait_sec = (attempt + 1) * 5
            logger.warning(f"Google Translate request failed (Attempt {attempt+1}/{retries}): {e}. Waiting {wait_sec}s...")
            time.sleep(wait_sec)

    # Fallback to original text if fails completely
    return text


def save_checkpoint(output_file: Path, items: List[Dict[str, Any]]):
    """Write translated items to file immediately."""
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def run_google_safe_translation():
    data_dir = Path(__file__).parent.parent / "data"
    input_file = data_dir / "extracted_english_selfharm.json"
    output_file = data_dir / "selfharm_vietnamese_augmented.json"

    if not input_file.exists():
        logger.error(f"{input_file} not found. Run extract_english_selfharm.py first!")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)

    logger.info(f"Loaded {len(extracted_data)} extracted English samples for Google Safe Translation...")

    # Load existing translations for seamless resume
    existing_map: Dict[str, dict] = {}
    augmented_results: List[dict] = []

    if output_file.exists():
        try:
            with open(output_file, "r", encoding="utf-8") as f:
                prev_data = json.load(f)
                for item in prev_data:
                    if isinstance(item, dict) and "id" in item and item.get("text"):
                        existing_map[item["id"]] = item
                        augmented_results.append(item)
            logger.info(f"Checkpoint restored! Resuming from sample {len(augmented_results)}/{len(extracted_data)}.")
        except Exception as e:
            logger.warning(f"Could not read previous checkpoint file ({e}). Starting fresh.")
            existing_map = {}
            augmented_results = []

    # Config delay settings for 20-30 min safe run (0.5s - 1.2s per request + random cooldown)
    MIN_DELAY = 0.5
    MAX_DELAY = 1.2
    COOLDOWN_INTERVAL = 50  # Every 50 requests, take a longer rest
    COOLDOWN_DURATION = 8.0  # Rest for 8 seconds

    new_translated_count = 0

    for idx, item in enumerate(extracted_data):
        item_id = item["id"]
        eng_text = item["text"]
        cat = item["category"]

        # Skip if already translated in checkpoint
        if item_id in existing_map and existing_map[item_id].get("text"):
            continue

        vi_translated = translate_google_gtx(eng_text)

        # Replace [TÊN] placeholders with realistic Vietnamese names
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
            "source": "Google-Translate-Safe-SelfHarm"
        }
        augmented_results.append(res_item)
        existing_map[item_id] = res_item
        new_translated_count += 1

        # Checkpoint save after every 5 items
        if new_translated_count % 5 == 0 or (idx + 1) == len(extracted_data):
            save_checkpoint(output_file, augmented_results)
            logger.info(
                f"Progress: [{len(augmented_results)}/{len(extracted_data)}] translated & saved to checkpoint."
            )

        # Safe rate-limit delay
        delay = random.uniform(MIN_DELAY, MAX_DELAY)
        time.sleep(delay)

        # Periodic longer cooldown rest to stay under Google radar
        if new_translated_count % COOLDOWN_INTERVAL == 0:
            logger.info(f"Cooling down for {COOLDOWN_DURATION} seconds to ensure 100% IP safety...")
            time.sleep(COOLDOWN_DURATION)

    # Final save
    save_checkpoint(output_file, augmented_results)
    logger.info(
        f"SUCCESS! 100% Google Safe Translation completed. Saved {len(augmented_results)} samples to {output_file}"
    )


if __name__ == "__main__":
    run_google_safe_translation()
