import os
import sys

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

os.environ["TRANSFORMERS_VERBOSITY"] = "error"

import json
import random
import re
import time
import logging
from pathlib import Path
from typing import List, Dict, Any
import requests

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add root app path for Preprocessing Pipeline
root_dir = Path(__file__).parent.parent.parent.parent
chatbot_app_path = root_dir / "apps" / "ai-chatbot-service"
if chatbot_app_path.exists():
    sys.path.append(str(chatbot_app_path))

try:
    from app.utils.text_cleaner import social_text_cleaner
    from app.utils.teencode import teencode_normalizer
    HAS_PIPELINE = True
except ImportError:
    HAS_PIPELINE = False

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


def fix_punctuation_spacing(text: str) -> str:
    if not text:
        return ""
    # Strip lyric / music subtitle hallucination artifacts (♪, ♫, 🎵, 🎶)
    text = re.sub(r"[♪♫🎵🎶]", "", text)
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    return text.strip()


def normalize_text(text: str) -> str:
    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    text = " ".join(text.split())
    text = fix_punctuation_spacing(text)
    return text


def clean_llm_meta_response(translated: str, english_text: str) -> str:
    """Clean meta-talk explanations if LLM responds with policy explanations instead of translation."""
    if not translated:
        return english_text

    # If LLM produces meta-response explanation (e.g., "Tôi không thể thực hiện...", "Nếu bạn muốn..."), fallback
    if "tôi không thể" in translated.lower() or "nhiệm vụ này" in translated.lower() or "câu dịch duy nhất" in translated.lower():
        logger.warning("Detected LLM meta-talk explanation instead of translation. Cleaning...")
        # Extract first line or clean fallback
        lines = [line.strip() for line in translated.split("\n") if line.strip()]
        for line in lines:
            if not ("tôi không thể" in line.lower() or "lưu ý:" in line.lower() or "nếu bạn" in line.lower()):
                return line.strip('"').strip("'")
        return english_text

    return translated.strip('"').strip("'")


def parse_dot_env(file_path: Path) -> Dict[str, str]:
    env_vars = {}
    if file_path.exists():
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        env_vars[k.strip()] = v.strip().strip("'").strip('"')
        except Exception:
            pass
    return env_vars


def load_env_vars():
    api_key = os.getenv("LLM_API_KEY") or os.getenv("XKIRO_API_KEY")
    base_url = os.getenv("LLM_BASE_URL")
    model_name = os.getenv("LLM_MODEL_NAME")

    eval_env = Path(__file__).parent.parent.parent / ".env"
    if eval_env.exists():
        parsed = parse_dot_env(eval_env)
        api_key = api_key or parsed.get("LLM_API_KEY") or parsed.get("XKIRO_API_KEY")
        base_url = base_url or parsed.get("LLM_BASE_URL")
        model_name = model_name or parsed.get("LLM_MODEL_NAME")

    return api_key, base_url, model_name


def call_llm_translate_direct(
    english_text: str,
    category: str,
    api_key: str,
    base_url: str,
    model_name: str,
    retries: int = 3
) -> str:
    """
    Direct LLM Translation for English Self-Harm & Depression Venting dataset.
    """
    if not api_key or not base_url:
        logger.error("LLM API key or Base URL missing!")
        return english_text

    category_guidance = (
        "Bảo toàn chính xác hành vi tự hại, ý định tự sát trực tiếp. Sử dụng từ ngữ chân thực, tự nhiên của mạng xã hội Việt Nam."
        if category == "SELF_HARM_EXPLICIT"
        else "Bảo toàn cảm xúc bế tắc, tuyệt vọng, trầm cảm, mệt mỏi xả stress. Sử dụng từ ngữ tâm sự tự nhiên."
    )

    prompt = f"""Dịch câu tiếng Anh sau sang 1 câu tiếng Việt tự nhiên theo phong cách mạng xã hội.

Yêu cầu:
- {category_guidance}
- Giữ nguyên các placeholder [NAME] hoặc [TÊN].
- TRẢ VỀ DUY NHẤT 1 CÂU DỊCH TIẾNG VIỆT. Không giải thích, không dẫn dắt.

Câu tiếng Anh: "{english_text}"
Câu dịch tiếng Việt:"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    url = f"{base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model_name or "gpt-4o-mini",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "max_tokens": 120
    }

    for attempt in range(retries):
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=15)
            if response.status_code == 200:
                res_json = response.json()
                translated = res_json["choices"][0]["message"]["content"].strip()
                cleaned = clean_llm_meta_response(translated, english_text)
                return cleaned
            else:
                time.sleep(1)
        except Exception as e:
            time.sleep(1)

    return english_text


def save_checkpoint(output_file: Path, items: List[Dict[str, Any]]):
    """Write translated items to file immediately after each batch/item."""
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def run_selfharm_llm_translation():
    data_dir = Path(__file__).parent.parent / "data"
    input_file = data_dir / "extracted_english_selfharm.json"
    output_file = data_dir / "selfharm_vietnamese_augmented.json"

    if not input_file.exists():
        logger.error(f"{input_file} not found. Run extract_english_selfharm.py first!")
        return

    with open(input_file, "r", encoding="utf-8") as f:
        extracted_data = json.load(f)

    logger.info(f"Loaded {len(extracted_data)} extracted English samples for 100% LLM Translation...")

    api_key, base_url, model_name = load_env_vars()
    if not api_key:
        logger.error("No LLM API Key detected! Please configure LLM_API_KEY in evaluation/.env")
        return

    logger.info(f"Using LLM Model: {model_name or 'default'} at {base_url}")

    # Load existing translations to support seamless checkpoint & resume
    existing_map: Dict[str, dict] = {}
    augmented_results: List[dict] = []

    if output_file.exists():
        try:
            with open(output_file, "r", encoding="utf-8") as f:
                prev_data = json.load(f)
                for item in prev_data:
                    if isinstance(item, dict) and "id" in item and item.get("text"):
                        # Clean meta talk if any existed in previous run
                        item["text"] = clean_llm_meta_response(item["text"], item["english_original"])
                        existing_map[item["id"]] = item
                        augmented_results.append(item)
            logger.info(f"Checkpoint restored! Resume from sample {len(augmented_results)}/{len(extracted_data)}.")
        except Exception as e:
            logger.warning(f"Could not read previous checkpoint file ({e}). Starting fresh.")
            existing_map = {}
            augmented_results = []

    new_translated_in_batch = 0
    BATCH_SAVE_INTERVAL = 5  # Immediately flush to disk every 5 items

    for idx, item in enumerate(extracted_data):
        item_id = item["id"]
        eng_text = item["text"]
        cat = item["category"]

        # Check if already translated in existing checkpoint
        if item_id in existing_map and existing_map[item_id].get("text"):
            continue

        raw_vi = call_llm_translate_direct(eng_text, cat, api_key, base_url, model_name)
        final_text = normalize_text(raw_vi)

        # Replace [TÊN] placeholders with realistic Vietnamese names
        if "[TÊN]" in final_text or "[NAME]" in final_text:
            random_name = random.choice(COMMON_VIETNAMESE_NAMES)
            final_text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", random_name, final_text, flags=re.IGNORECASE)

        if len(final_text.split()) < 2:
            continue

        res_item = {
            "id": item_id,
            "text": final_text,
            "english_original": eng_text,
            "category": cat,
            "label": CATEGORY_TO_LABEL_ID.get(cat, 3),
            "label_name": "SELF_HARM_CRISIS",
            "source": "LLM-Translated-SelfHarm-Augmented"
        }
        augmented_results.append(res_item)
        existing_map[item_id] = res_item
        new_translated_in_batch += 1

        # Immediate batch save to disk to guarantee resume capability on crash/restart
        if new_translated_in_batch % BATCH_SAVE_INTERVAL == 0 or (idx + 1) == len(extracted_data):
            save_checkpoint(output_file, augmented_results)
            logger.info(
                f"[{len(augmented_results)}/{len(extracted_data)}] Translated & Saved Checkpoint to {output_file.name}"
            )

    # Final save on exit
    save_checkpoint(output_file, augmented_results)
    logger.info(
        f"100% LLM Translation completed! Saved all {len(augmented_results)} samples to {output_file}"
    )


if __name__ == "__main__":
    run_selfharm_llm_translation()
