import os
import sys

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

import json
import re
import time
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Dict, List

import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

# Add root app path for Preprocessing Pipeline if available
root_dir = Path(__file__).parent.parent
chatbot_app_path = root_dir / "apps" / "ai-chatbot-service"
if chatbot_app_path.exists():
    sys.path.append(str(chatbot_app_path))

try:
    from app.utils.text_cleaner import social_text_cleaner
    from app.utils.teencode import teencode_normalizer
    HAS_PIPELINE_MODULES = True
except ImportError:
    HAS_PIPELINE_MODULES = False

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]



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


def normalize_vietnamese_text(text: str) -> str:
    """Clean and normalize Vietnamese translated text without emoji label leakage."""
    if HAS_PIPELINE_MODULES:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    
    text = " ".join(text.split())
    text = fix_punctuation_spacing(text)
    return text




def get_translator():
    """Lazy load MarianMT model for offline translation."""
    model_name = "Helsinki-NLP/opus-mt-en-vi"

    print(f"[MODEL] Loading offline translation model ({model_name})...", flush=True)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    print(f"[MODEL] Loaded model successfully on device: {device.upper()}", flush=True)
    return tokenizer, model, device


def translate_batch_offline(texts: List[str], tokenizer, model, device) -> List[str]:
    """Translate batch of English texts to Vietnamese using offline MarianMT model."""
    if not texts:
        return []

    # Protect placeholders like [NAME]
    processed_texts = [re.sub(r"\[NAME\]", "___NAME___", t, flags=re.IGNORECASE) for t in texts]

    inputs = tokenizer(processed_texts, return_tensors="pt", padding=True, truncation=True, max_length=256).to(device)
    with torch.no_grad():
        translated_tokens = model.generate(**inputs, max_length=256)
    
    raw_results = tokenizer.batch_decode(translated_tokens, skip_special_tokens=True)

    final_results = []
    for translated_text in raw_results:
        # Restore placeholders
        translated_text = re.sub(r"___NAME___|___ NAME ___", "[TÊN]", translated_text)
        final_results.append(translated_text)

    return final_results


from quality_gate import compute_risk_score


def run_goemotions_translation():
    data_dir = Path(__file__).parent.parent / "data"
    extracted_file = data_dir / "goemotions_minority_extracted.json"
    out_file = data_dir / "goemotions_translated.json"


    if not extracted_file.exists():
        print(f"[ERROR] {extracted_file} not found. Run extract_goemotions.py first.")
        return

    with open(extracted_file, "r", encoding="utf-8") as f:
        target_samples = json.load(f)

    # Load existing translations lookup map
    existing_map: Dict[str, dict] = {}
    if out_file.exists():
        try:
            with open(out_file, "r", encoding="utf-8") as f:
                old_data = json.load(f)
                for item in old_data:
                    orig = item.get("original_english")
                    if orig:
                        existing_map[orig] = item
            print(f"[CACHE] Found {len(existing_map)} previously translated samples.")
        except Exception:
            existing_map = {}

    total = len(target_samples)
    print(f"Total minority samples to translate: {total}.")

    # Collect items that actually need translation
    untranslated_items = []
    for item in target_samples:
        if item["english_text"] not in existing_map:
            untranslated_items.append(item)

    print(f"Already cached: {len(existing_map)} | Remaining to translate offline: {len(untranslated_items)}")

    tokenizer, model, device = None, None, None
    if untranslated_items:
        tokenizer, model, device = get_translator()

    augmented_samples: List[dict] = []
    reused_count = 0
    new_translated_count = 0
    start_time = time.time()

    # Batch process untranslated items
    batch_size = 32
    translated_cache = {}

    for i in range(0, len(untranslated_items), batch_size):
        batch = untranslated_items[i:i + batch_size]
        batch_engs = [item["english_text"] for item in batch]
        
        batch_viets = translate_batch_offline(batch_engs, tokenizer, model, device)
        
        for eng, viet in zip(batch_engs, batch_viets):
            translated_cache[eng] = viet
            
        new_translated_count += len(batch)
        elapsed = time.time() - start_time
        current_processed = len(existing_map) + new_translated_count
        print(f"[OFFLINE TRANSLATE] Processed {current_processed}/{total} ({(current_processed/total)*100:.1f}%) | Batch size: {len(batch)} | Elapsed: {elapsed:.1f}s", flush=True)

    risk_counts = {"LOW_RISK": 0, "MEDIUM_RISK": 0, "HIGH_RISK": 0}

    # Construct final list in original order with Quality Gate Evaluation
    for item in target_samples:
        eng_text = item["english_text"]
        label_id = item["target_label"]
        label_name = item["label_name"]

        if eng_text in existing_map:
            viet_text = existing_map[eng_text].get("raw_translated") or existing_map[eng_text].get("text")
            reused_count += 1
        else:
            viet_text = translated_cache.get(eng_text, eng_text)

        cleaned_text = normalize_vietnamese_text(viet_text)

        # Evaluate Quality Gate Score
        risk_score, risk_category, gate_details = compute_risk_score(eng_text, cleaned_text, label_name)
        risk_counts[risk_category] += 1

        augmented_samples.append({
            "text": cleaned_text,
            "raw_translated": viet_text,
            "original_english": eng_text,
            "label": label_id,
            "label_name": label_name,
            "source": "GoEmotions-MarianMT-Offline-Augmented",
            "quality_gate": {
                "risk_score": risk_score,
                "risk_category": risk_category,
                "routing_decision": "LLM_API" if risk_category == "HIGH_RISK" else "MARIANMT_LOCAL",
                "details": gate_details
            }
        })

    # Save output
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(augmented_samples, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 60, flush=True)
    print("GOEMOTIONS OFFLINE TRANSLATION & QUALITY GATE COMPLETED!", flush=True)
    print(f"Total samples in final dataset: {len(augmented_samples)}", flush=True)
    print(f" - Reused from cache:    {reused_count}", flush=True)
    print(f" - Newly translated:      {new_translated_count}", flush=True)
    print("Quality Gate Breakdown:", flush=True)
    print(f" - LOW_RISK (MarianMT):   {risk_counts['LOW_RISK']}", flush=True)
    print(f" - MEDIUM_RISK (Review):  {risk_counts['MEDIUM_RISK']}", flush=True)
    print(f" - HIGH_RISK (Needs LLM): {risk_counts['HIGH_RISK']}", flush=True)
    print(f"Saved translated dataset to: {out_file}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    run_goemotions_translation()


