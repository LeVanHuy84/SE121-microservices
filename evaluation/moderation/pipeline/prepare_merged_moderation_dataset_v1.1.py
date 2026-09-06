import re
import sys
import json
import random
import logging
from pathlib import Path

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
from typing import Dict, List, Any
from datasets import load_dataset
from sklearn.model_selection import train_test_split

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

# Unified Multi-Label Moderation Taxonomy
MODERATION_LABELS = {
    0: "CLEAN",
    1: "PROFANITY_VENTING",
    2: "HATE_SPEECH",
    3: "EMOTIONAL_CRISIS",
    4: "ILLEGAL_PORN"
}


def fix_punctuation_spacing(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    return text.strip()


def normalize_vietnamese_text(text: str) -> str:
    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    text = " ".join(text.split())
    text = fix_punctuation_spacing(text)
    return text


def prepare_merged_moderation_dataset_v1_1(
    target_clean_count: int = 8000
) -> Dict[str, Any]:
    """
    Generate v1.1 Dataset with Undersampled CLEAN label (8,000 samples) to eliminate class bias
    and boost Macro F1-score across all violation categories. Saved in data/v1.1/
    """
    mod_dir = Path(__file__).parent.parent
    data_v1_0_dir = mod_dir / "data"
    data_v1_1_dir = mod_dir / "data" / "v1.1"
    data_v1_1_dir.mkdir(parents=True, exist_ok=True)

    logger.info("Loading baseline ViHSD dataset...")
    all_vihsd_samples = []
    vihsd_candidates = ["visolex/ViHSD", "visolex/vihsd", "uitnlp/vihsd"]

    for candidate in vihsd_candidates:
        try:
            logger.info(f"Attempting to load ViHSD dataset from '{candidate}'...")
            ds = load_dataset(candidate)
            split_keys = list(ds.keys())
            for key in split_keys:
                for item in ds[key]:
                    all_vihsd_samples.append(item)
            logger.info(f"Successfully loaded {len(all_vihsd_samples)} baseline ViHSD samples from '{candidate}'.")
            break
        except Exception as e:
            logger.warning(f"Could not load '{candidate}': {e}")
            continue

    # Load Translated / Augmented Self-Harm Dataset
    sh_file = data_v1_0_dir / "selfharm_vietnamese_augmented.json"
    translated_sh_samples = []
    if sh_file.exists():
        with open(sh_file, "r", encoding="utf-8") as f:
            translated_sh_samples = json.load(f)
        logger.info(f"Successfully loaded {len(translated_sh_samples)} Self-Harm samples.")

    # Process ViHSD Samples & Separate CLEAN from Violations
    vihsd_map = {0: 0, 1: 1, 2: 2}
    clean_vihsd_samples = []
    violation_vihsd_samples = []

    for item in all_vihsd_samples:
        raw_text = item.get("free_text", item.get("text", item.get("comment", "")))
        if not raw_text:
            continue
        raw_label = item.get("label_id", item.get("label", 0))
        target_label = vihsd_map.get(raw_label, 0)
        cleaned_text = normalize_vietnamese_text(raw_text)

        sample_dict = {
            "text": cleaned_text,
            "raw_text": raw_text,
            "label": target_label,
            "label_name": MODERATION_LABELS[target_label],
            "source": "UIT-ViHSD"
        }

        if target_label == 0:
            clean_vihsd_samples.append(sample_dict)
        else:
            violation_vihsd_samples.append(sample_dict)

    # Perform Random Undersampling on CLEAN samples (seed 42)
    random.seed(42)
    if len(clean_vihsd_samples) > target_clean_count:
        clean_vihsd_samples = random.sample(clean_vihsd_samples, target_clean_count)
        logger.info(f"Undersampled CLEAN label to exactly {len(clean_vihsd_samples)} samples.")

    merged_samples = clean_vihsd_samples + violation_vihsd_samples

    # Process Translated Self-Harm Samples
    for item in translated_sh_samples:
        raw_text = item.get("text", item.get("vietnamese_text", item.get("vietnamese_translation", "")))
        if not raw_text or len(raw_text.split()) < 2:
            continue

        cat = item.get("category", "")
        if cat in ["SELF_HARM_EXPLICIT", "DEPRESSION_VENTING"]:
            target_label = 3
        else:
            target_label = item.get("label", 3)

        cleaned_text = normalize_vietnamese_text(raw_text)
        merged_samples.append({
            "text": cleaned_text,
            "raw_text": raw_text,
            "english_original": item.get("english_original", ""),
            "label": target_label,
            "label_name": MODERATION_LABELS[target_label],
            "source": item.get("source", "Google-Translate-Playwright-Web")
        })

    logger.info(f"Total merged v1.1 dataset samples (after CLEAN undersampling): {len(merged_samples)}")

    # 2-Step Stratified Split for Deep Learning standard ratio: Train (70%), Val (15%), Test (15%)
    labels = [x["label"] for x in merged_samples]
    
    train_samples, temp_samples = train_test_split(
        merged_samples,
        test_size=0.30,
        random_state=42,
        stratify=labels if len(set(labels)) > 1 else None
    )

    temp_labels = [x["label"] for x in temp_samples]
    val_samples, test_samples = train_test_split(
        temp_samples,
        test_size=0.50,
        random_state=42,
        stratify=temp_labels if len(set(temp_labels)) > 1 else None
    )

    def get_label_distribution(dataset_split: List[dict]) -> Dict[str, int]:
        dist = {MODERATION_LABELS[i]: 0 for i in MODERATION_LABELS}
        for sample in dataset_split:
            l_name = sample["label_name"]
            dist[l_name] = dist.get(l_name, 0) + 1
        return dist

    train_dist = get_label_distribution(train_samples)
    val_dist = get_label_distribution(val_samples)
    test_dist = get_label_distribution(test_samples)

    # Save 3 clean separate files to data/v1.1 directory
    train_file = data_v1_1_dir / "train.json"
    val_file = data_v1_1_dir / "val.json"
    test_file = data_v1_1_dir / "test.json"

    with open(train_file, "w", encoding="utf-8") as f:
        json.dump(train_samples, f, ensure_ascii=False, indent=2)

    with open(val_file, "w", encoding="utf-8") as f:
        json.dump(val_samples, f, ensure_ascii=False, indent=2)

    with open(test_file, "w", encoding="utf-8") as f:
        json.dump(test_samples, f, ensure_ascii=False, indent=2)

    output_payload = {
        "metadata": {
            "version": "v1.1",
            "description": "Undersampled CLEAN label (8,000 samples) for balanced macro F1 score",
            "total_samples": len(merged_samples),
            "split_ratios": {"train": "70%", "val": "15%", "test": "15%"},
            "counts": {
                "train_samples": len(train_samples),
                "val_samples": len(val_samples),
                "test_samples": len(test_samples)
            },
            "taxonomy": MODERATION_LABELS,
            "distributions": {
                "train": train_dist,
                "val": val_dist,
                "test": test_dist
            }
        },
        "train": train_samples,
        "val": val_samples,
        "test": test_samples
    }

    combined_file = data_v1_1_dir / "merged_moderation_dataset_v1.1.json"
    with open(combined_file, "w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2)

    logger.info(f"Saved 3 separate dataset files in data/v1.1: train.json ({len(train_samples)}), val.json ({len(val_samples)}), test.json ({len(test_samples)})")
    return output_payload


if __name__ == "__main__":
    result = prepare_merged_moderation_dataset_v1_1()
    print("v1.1 Merged dataset metadata:", json.dumps(result.get("metadata"), ensure_ascii=False, indent=2))
