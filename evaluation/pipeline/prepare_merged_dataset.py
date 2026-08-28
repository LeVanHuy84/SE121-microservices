import re
import sys
from pathlib import Path
import json
from datasets import load_dataset
from sklearn.model_selection import train_test_split


# Add root app path for Preprocessing Pipeline
root_dir = Path(__file__).parent.parent
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


def fix_punctuation_spacing(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"\[\s*(?:TÊN|NAME)\s*\]", "[TÊN]", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+([,.:!?;\)])", r"\1", text)
    text = re.sub(r"(\()\s+", r"\1", text)
    text = re.sub(r"/\s+s\b", "/s", text)
    return text.strip()


def normalize_vietnamese_text(text: str) -> str:
    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    text = " ".join(text.split())
    text = fix_punctuation_spacing(text)
    return text


def prepare_merged_dataset():
    data_dir = Path(__file__).parent.parent / "data"
    
    # 1. Load entire baseline UIT-VSMEC dataset (6,927 samples)
    print("Loading baseline UIT-VSMEC dataset...")
    ds = load_dataset("visolex/UIT-VSMEC")

    keys = list(ds.keys())
    all_vsmec = [x for x in ds[keys[0]]]
    print(f"Loaded total VSMEC samples: {len(all_vsmec)}")
    
    # 2. Load Quality-Gated GoEmotions augmented samples
    aug_file = data_dir / "goemotions_vietnamese_augmented.json"
    if not aug_file.exists():
        print(f"Error: {aug_file} not found!")
        return

    with open(aug_file, "r", encoding="utf-8") as f:
        goemotions_samples = json.load(f)

    print(f"Loaded GoEmotions Quality-Gated Augmented Samples: {len(goemotions_samples)}")

    # 3. Format & Merge ALL samples
    all_samples = []
    
    # Format VSMEC samples
    for item in all_vsmec:
        raw_text = item.get("Sentence", item.get("comment", item.get("text", "")))
        label = item.get("Emotion", item.get("label", 0))
        if isinstance(label, str):
            label_to_id = {name: i for i, name in enumerate(LABEL_NAMES)}
            label = label_to_id.get(label, 0)
            
        cleaned_text = normalize_vietnamese_text(raw_text)
        all_samples.append({
            "text": cleaned_text,
            "raw_text": raw_text,
            "label": label,
            "label_name": LABEL_NAMES[label],
            "source": "UIT-VSMEC"
        })

    # Format GoEmotions samples (with quality filtering: len >= 3 words)
    filtered_goemotions = 0
    for item in goemotions_samples:
        text = item["text"].strip()
        # Quality filter: skip overly short corrupted translations (< 3 words)
        if len(text.split()) < 3:
            filtered_goemotions += 1
            continue
            
        all_samples.append({
            "text": text,
            "raw_text": item.get("raw_translated", item["text"]),
            "label": item["label"],
            "label_name": item["label_name"],
            "source": item.get("source", "GoEmotions-Augmented")
        })

    print(f"Filtered out {filtered_goemotions} overly short/corrupted GoEmotions samples (< 3 words).")

    # Deduplicate based on cleaned text to prevent data leak / noise
    seen_texts = set()
    unique_samples = []
    for sample in all_samples:
        if sample["text"] not in seen_texts:
            seen_texts.add(sample["text"])
            unique_samples.append(sample)

    all_samples = unique_samples
    total_count = len(all_samples)
    print(f"Total Merged Cleaned & Deduplicated Corpus Size: {total_count} samples")


    # 4. Perform Stratified 70% Train / 15% Val / 15% Test Split
    labels = [x["label"] for x in all_samples]
    
    # Step 1: Split 70% Train and 30% Temp (Val + Test)
    train_data, temp_data = train_test_split(
        all_samples, 
        test_size=0.30, 
        random_state=42, 
        stratify=labels
    )
    
    # Step 2: Split 30% Temp into 15% Val and 15% Test
    temp_labels = [x["label"] for x in temp_data]
    val_data, test_data = train_test_split(
        temp_data, 
        test_size=0.50, 
        random_state=42, 
        stratify=temp_labels
    )

    print(f"Stratified Split Completed: Train={len(train_data)} (70%), Val={len(val_data)} (15%), Test={len(test_data)} (15%)")

    # Tag splits inside samples
    for item in train_data: item["split"] = "train"
    for item in val_data: item["split"] = "val"
    for item in test_data: item["split"] = "test"

    # Save individual split files
    with open(data_dir / "phobert_train.json", "w", encoding="utf-8") as f:
        json.dump(train_data, f, ensure_ascii=False, indent=2)

    with open(data_dir / "phobert_val.json", "w", encoding="utf-8") as f:
        json.dump(val_data, f, ensure_ascii=False, indent=2)

    with open(data_dir / "phobert_test.json", "w", encoding="utf-8") as f:
        json.dump(test_data, f, ensure_ascii=False, indent=2)

    # Save full merged file with split labels for reference
    full_merged = train_data + val_data + test_data
    with open(data_dir / "phobert_finetune_merged_dataset.json", "w", encoding="utf-8") as f:
        json.dump(full_merged, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 65)
    print("STRATIFIED DATASET PREPARATION COMPLETED (70 / 15 / 15)")
    print(f"Train Set : {len(train_data)} samples -> phobert_train.json")
    print(f"Val Set   : {len(val_data)} samples -> phobert_val.json")
    print(f"Test Set  : {len(test_data)} samples -> phobert_test.json")
    print("=" * 65)


if __name__ == "__main__":
    prepare_merged_dataset()


