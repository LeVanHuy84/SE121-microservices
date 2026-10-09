import json
import re
import sys
from pathlib import Path
from datasets import load_dataset

# Ensure UTF-8 output encoding on Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 28 GoEmotions Classes (Standard Alphabetical Order from ACL 2020 paper)
ALL_GOEMOTIONS = [
    "admiration", "amusement", "anger", "annoyance", "approval", "caring", 
    "confusion", "curiosity", "desire", "disappointment", "disapproval", 
    "disgust", "embarrassment", "excitement", "fear", "gratitude", "grief", 
    "joy", "love", "nervousness", "optimism", "pride", "realization", 
    "relief", "remorse", "sadness", "surprise", "neutral"
]

# Pure Affective Ekman Mapping (Strictly affective, excluding cognitive/attitude labels)
PURE_EKMAN_MAPPING = {
    # Enjoyment (Pure Joy / Fun / Excitement)
    "joy": "Enjoyment",
    "amusement": "Enjoyment",
    "excitement": "Enjoyment",

    # Sadness (Pure Sorrow / Grief / Disappointment)
    "sadness": "Sadness",
    "grief": "Sadness",
    "disappointment": "Sadness",

    # Anger (Pure Anger / Frustration / Annoyance)
    "anger": "Anger",
    "annoyance": "Anger",

    # Fear (Pure Fear / Nervousness)
    "fear": "Fear",
    "nervousness": "Fear",

    # Disgust (Pure Revulsion)
    "disgust": "Disgust",

    # Surprise (Pure Shock / Astonishment)
    "surprise": "Surprise",
}

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]
LABEL_TO_ID = {name: idx for idx, name in enumerate(LABEL_NAMES)}


def split_sentences(text: str) -> list[str]:
    """Split English text into sentences using punctuation boundaries."""
    sentences = re.split(r'[.!?]+', text.strip())
    return [s.strip() for s in sentences if len(s.strip()) > 0]


def is_clean_social_text(text: str) -> bool:
    """Filter out Reddit noise, URLs, user tags, markdown links, or deleted comments."""
    text_lower = text.lower()
    
    # Check URLs, subreddits, user references
    if any(k in text_lower for k in ["http://", "https://", "www.", "r/", "u/"]):
        return False
        
    # Check deleted / removed markers
    if "[deleted]" in text_lower or "[removed]" in text_lower:
        return False
        
    # Check edit tags and markdown link artifacts
    if re.search(r"\bedit:\b|\bedited:\b", text_lower) or re.search(r"\[.*?\]\(.*?\)", text):
        return False
        
    # Check HTML tags or entities
    if re.search(r"&(?:amp|gt|lt|quot|apos);", text) or "<" in text:
        return False

    return True


def extract_pure_long_goemotions(target_count: int = 250) -> list[dict]:
    """
    Extract long, multi-label comments from GoEmotions using PURE Ekman emotions.
    Criteria:
      1. Word count >= 15
      2. Sentence count >= 2
      3. At least 2 distinct Pure Ekman emotions (genuine co-occurrence)
      4. Text is clean (no URLs, markdown noise)
      5. Pure multi-label format (no artificial primary/secondary dichotomy)
    """
    print(f"[EXTRACT] Đang tải GoEmotions dataset từ HuggingFace cache...")
    raw_dataset = load_dataset("go_emotions")
    
    candidates = []
    seen_texts = set()

    for split_name in ["test", "validation", "train"]:
        split_data = raw_dataset[split_name]
        print(f"[EXTRACT] Đang duyệt qua split '{split_name}' ({len(split_data)} mẫu)...")
        
        for item in split_data:
            text = item["text"].strip()
            if text in seen_texts:
                continue
                
            if not is_clean_social_text(text):
                continue
                
            words = text.split()
            if len(words) < 15:
                continue
                
            sentences = split_sentences(text)
            if len(sentences) < 2:
                continue
                
            raw_label_ids = item["labels"]
            if not raw_label_ids:
                continue
                
            raw_emotions = [ALL_GOEMOTIONS[lid] for lid in raw_label_ids if lid < len(ALL_GOEMOTIONS)]
            
            # Map only to Pure Ekman emotions
            ekman_set = []
            for e in raw_emotions:
                mapped = PURE_EKMAN_MAPPING.get(e)
                if mapped and mapped not in ekman_set:
                    ekman_set.append(mapped)

            # Require at least 2 distinct Pure Ekman emotions
            if len(ekman_set) < 2:
                continue

            # Multi-label binary vector (length 7)
            binary_vector = [0] * len(LABEL_NAMES)
            for e in ekman_set:
                binary_vector[LABEL_TO_ID[e]] = 1

            candidates.append({
                "id": f"GO_LONG_{len(candidates) + 1:04d}",
                "original_english": text,
                "split": split_name,
                "word_count": len(words),
                "sentence_count": len(sentences),
                "raw_goemotions": raw_emotions,
                "ground_truth": {
                    "emotions": ekman_set,
                    "binary_vector_7": binary_vector
                },
                "is_co_occurring": True
            })
            seen_texts.add(text)

            if len(candidates) >= target_count:
                break
                
        if len(candidates) >= target_count:
            break

    print(f"\n[EXTRACT] Đã trích xuất thành công {len(candidates)} mẫu chuẩn vàng Pure Ekman!")
    
    # Class distribution statistics
    print("\n--- THỐNG KÊ TỔNG SỐ LẦN XUẤT HIỆN TỪNG NHÃN PURE EKMAN ---")
    all_dist = {}
    for c in candidates:
        for e in c["ground_truth"]["emotions"]:
            all_dist[e] = all_dist.get(e, 0) + 1
    for label, count in sorted(all_dist.items()):
        print(f"  • {label:12s}: {count:3d} lần xuất hiện ({count/len(candidates)*100:.1f}%)")

    return candidates


def main():
    target_count = 250
    extracted = extract_pure_long_goemotions(target_count=target_count)
    
    out_dir = Path(__file__).resolve().parent.parent / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "goemotions_long_en.json"
    
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(extracted, f, ensure_ascii=False, indent=2)
        
    print(f"\n[HOÀN THÀNH] File dữ liệu tiếng Anh Pure Ekman đã lưu tại: {out_file}")


if __name__ == "__main__":
    main()
