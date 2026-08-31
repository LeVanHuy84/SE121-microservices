import os
import sys

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Suppress HuggingFace transformers PyTorch warning log
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

import json
import random
import re
import time
from pathlib import Path
from typing import List, Dict
import requests

# Add root app path for Preprocessing Pipeline
root_dir = Path(__file__).parent.parent.parent
chatbot_app_path = root_dir / "apps" / "ai-chatbot-service"
if chatbot_app_path.exists():
    sys.path.append(str(chatbot_app_path))

try:
    from app.utils.text_cleaner import social_text_cleaner
    from app.utils.teencode import teencode_normalizer
    HAS_PIPELINE = True
except ImportError:
    HAS_PIPELINE = False

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]


# Common Vietnamese names to replace [TÊN] / [NAME] placeholders
COMMON_VIETNAMESE_NAMES = [
    "Nam", "Linh", "Hùng", "Hương", "Tuấn", "Mai", "Hoàng", "Trang", 
    "Phong", "Đạt", "Lan", "Huy", "Thảo", "Dũng", "Ngọc", "Anh", 
    "Quang", "Phương", "Minh", "Hà", "Đức", "Thành", "Khánh", "Hải",
    "Yến", "Thúy", "Bình", "Vũ", "Sơn", "Long"
]


def fix_punctuation_spacing(text: str) -> str:

    """Fix spaces around punctuation and standardize placeholders to research token [TÊN]."""
    if not text:
        return ""
    # Standardize name placeholders like [NAME], [ TÊN ], [ NAME ] -> [TÊN]
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    # Remove space before punctuation marks: , . ! ? : ;
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    # Remove space after open parenthesis
    text = re.sub(r"(\()\s+", r"\1", text)
    # Fix / s -> /s
    text = re.sub(r"/\s+s\b", "/s", text)
    return text.strip()


def standalone_normalize_text(text: str) -> dict:
    """Standalone normalization without triggering PyTorch / CLIP model imports and without emoji label leakage."""
    original = text

    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)

    text = " ".join(text.split())
    text = fix_punctuation_spacing(text)
    return {"text": text, "hasEmoji": False, "original": original}




def parse_dot_env(file_path: Path) -> Dict[str, str]:
    """Parse local .env file manually when Python script executes."""
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
    """Load LLM API environment variables automatically from local .env file or OS shell."""
    api_key = os.getenv("LLM_API_KEY") or os.getenv("XKIRO_API_KEY")
    base_url = os.getenv("LLM_BASE_URL")
    model_name = os.getenv("LLM_MODEL_NAME")

    eval_env = Path(__file__).parent.parent / ".env"
    file_vars = parse_dot_env(eval_env)

    if not api_key:
        api_key = file_vars.get("LLM_API_KEY") or file_vars.get("XKIRO_API_KEY")
    if not base_url:
        base_url = file_vars.get("LLM_BASE_URL", "https://api.xkiro.com/v1")
    if not model_name:
        model_name = file_vars.get("LLM_MODEL_NAME", "stealth/ox-alpha-free")

    return api_key, base_url, model_name


def call_llm_translate_single(text: str, target_emotion: str, api_key: str, base_url: str, model_name: str, retries: int = 3) -> str:
    """Single sentence translation with error handling and strict prompt."""
    prompt = f"""Bạn là chuyên gia dịch thuật ngữ liệu mạng xã hội (Social Media Corpus Translator).
Nhiệm vụ: Dịch câu tiếng Anh sau sang tiếng Việt tự nhiên, trung thực với nghĩa gốc và bảo toàn sắc thái cảm xúc '{target_emotion}'.

QUY TẮC BẮT BUỘC:
1. Dịch chuẩn xác nghĩa đen và ngữ cảnh. KHÔNG tự ý suy diễn, KHÔNG tự ý chèn các từ chửi thề nặng nề (như "đồ chó đẻ", "tí hon") nếu bản gốc không có.
2. Giữ nguyên các thẻ placeholder như [NAME] hoặc đổi thành [TÊN].
3. KHÔNG tự ý thêm các từ cảm thán như "Ủa", "luôn ấy", "trời ơi" trừ khi bản gốc thực sự chứa từ cảm thán tương đương (như "Omg", "Wow", "Oh").
4. Chỉ trả về duy nhất 1 câu dịch tiếng Việt, không kèm bất kỳ lời giải thích hay ngoặc kép nào.

Câu tiếng Anh: "{text}"
Câu dịch tiếng Việt:"""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 100
    }

    for attempt in range(retries):
        try:
            url = f"{base_url.rstrip('/')}/chat/completions"
            resp = requests.post(url, headers=headers, json=payload, timeout=20)
            if resp.status_code == 200:
                res_json = resp.json()
                content = res_json["choices"][0]["message"]["content"].strip().strip('"')
                return content
            else:
                time.sleep(1)
        except Exception:
            time.sleep(1)

    return text


def process_and_augment_goemotions():
    api_key, base_url, model_name = load_env_vars()
    data_dir = Path(__file__).parent.parent / "data"
    translated_file = data_dir / "goemotions_translated.json"
    out_file = data_dir / "goemotions_vietnamese_augmented.json"


    if not translated_file.exists():
        print(f"Error: {translated_file} not found. Run translate_goemotions.py first.")
        return

    with open(translated_file, "r", encoding="utf-8") as f:
        marian_samples = json.load(f)

    # 1. LOAD EXISTING LLM AUGMENTED TRANSLATIONS MAP
    existing_map = {}
    if out_file.exists():
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                existing_map = {item["original_english"]: item for item in old_data if "original_english" in item}
            print(f"[CACHE] Found {len(existing_map)} previously LLM-augmented samples.")
        except Exception:
            existing_map = {}

    total = len(marian_samples)
    reused_count = 0
    llm_translated_count = 0
    marian_kept_count = 0

    augmented_samples = []

    print(f"Total target samples: {total}.")
    print(f"Using Model: {model_name} via Base URL: {base_url}")

    for idx, item in enumerate(marian_samples):
        eng_text = item["original_english"]
        marian_viet = item["text"]
        label_id = item["label"]
        label_name = item["label_name"]
        qgate = item.get("quality_gate", {})
        risk_category = qgate.get("risk_category", "LOW_RISK")

        # Smart Budget Routing: Send ALL Anger samples (Label 3) as well as MEDIUM_RISK / HIGH_RISK samples to LLM API for strict tone verification
        needs_llm_refinement = (label_id == 3) or (risk_category in ["MEDIUM_RISK", "HIGH_RISK"])

        if needs_llm_refinement:
            # Force fresh LLM API call for Anger samples (label_id == 3) to fix label noise
            if label_id != 3 and eng_text in existing_map and existing_map[eng_text].get("source") == "GoEmotions-LLM-Refined":
                final_viet = existing_map[eng_text].get("raw_translated") or existing_map[eng_text].get("text")
                reused_count += 1
            else:
                if api_key:
                    final_viet = call_llm_translate_single(eng_text, label_name, api_key, base_url, model_name)
                    time.sleep(0.05)
                else:
                    print(f"[WARNING] Missing API Key! Fallback to MarianMT for: {eng_text[:30]}...")
                    final_viet = marian_viet
                llm_translated_count += 1
            source_tag = "GoEmotions-LLM-Refined"

        else:
            final_viet = marian_viet
            marian_kept_count += 1
            source_tag = "GoEmotions-MarianMT-Offline"

        # Pass text through Standalone Preprocessing Pipeline without emoji leakage
        prep = standalone_normalize_text(final_viet)
        cleaned_text = prep["text"]

        augmented_samples.append({
            "text": cleaned_text,
            "raw_translated": final_viet,
            "original_english": eng_text,
            "label": label_id,
            "label_name": label_name,
            "source": source_tag,
            "quality_gate": qgate
        })

        # Save checkpoint after every 20 samples
        if (idx + 1) % 20 == 0 or (idx + 1) == total:
            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(augmented_samples, f, ensure_ascii=False, indent=2)
            print(f"[CHECKPOINT] [{idx + 1}/{total}] | MarianMT Kept: {marian_kept_count} | LLM Refined: {llm_translated_count} | Reused Cache: {reused_count}")

    # Final save
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(augmented_samples, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60)
    print("GOEMOTIONS QUALITY-GATED HYBRID AUGMENTATION COMPLETED!")
    print(f"Total samples in final dataset: {len(augmented_samples)}")
    print(f" - Kept from MarianMT (LOW/MED RISK): {marian_kept_count}")
    print(f" - Newly translated via LLM (HIGH RISK): {llm_translated_count}")
    print(f" - Reused from LLM cache:              {reused_count}")
    print(f"Saved dataset to: {out_file}")
    print("=" * 60)


if __name__ == "__main__":
    process_and_augment_goemotions()

