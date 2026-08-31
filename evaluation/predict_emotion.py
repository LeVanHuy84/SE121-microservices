import os
import sys
import numpy as np
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# Import underthesea for sentence splitting & word segmentation
try:
    from underthesea import sent_tokenize, word_tokenize
    HAS_UNDERTHESEA = True
except ImportError:
    HAS_UNDERTHESEA = False

# Add root app path for Preprocessing Pipeline
eval_dir = Path(__file__).parent
root_dir = eval_dir.parent
sys.path.append(str(root_dir / "apps" / "ai-chatbot-service"))

try:
    from app.utils.text_cleaner import social_text_cleaner
    from app.utils.teencode import teencode_normalizer
    HAS_PIPELINE = True
except ImportError:
    HAS_PIPELINE = False

MODEL_PATH = eval_dir / "weights" / "phobert_emotion_final"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

LABEL_TRANSLATIONS = {
    "Enjoyment": "😊 Vui vẻ / Yêu thích (Enjoyment)",
    "Sadness": "😭 Buồn rầu / Thất vọng (Sadness)",
    "Disgust": "🤮 Chán ghét / Khinh bỉ (Disgust)",
    "Anger": "😡 Tức giận / Bực mình (Anger)",
    "Fear": "😱 Sợ hãi / Lo lắng (Fear)",
    "Surprise": "😲 Ngạc nhiên / Bất ngờ (Surprise)",
    "Other": "😐 Khác / Trung tính (Other)"
}


def preprocess_single_sentence(text: str, apply_word_tokenize: bool = True) -> str:
    """Clean, normalize teencode, and optionally apply underthesea word_tokenize."""
    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    
    if HAS_UNDERTHESEA and apply_word_tokenize:
        # Segment Vietnamese compound words (e.g. sầu riêng -> sầu_riêng)
        text = word_tokenize(text, format="text")
        
    return " ".join(text.split())


def load_fine_tuned_model():
    """Load tokenizer and fine-tuned model."""
    if not MODEL_PATH.exists():
        print(f"[LỖI] Không tìm thấy weights mô hình tại: {MODEL_PATH}")
        sys.exit(1)

    print(f"[THÔNG BÁO] Đang nạp mô hình PhoBERT Fine-Tuned từ local path ({DEVICE.upper()})...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_PATH))
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_PATH))
    model.to(DEVICE)
    model.eval()
    print("[THÔNG BÁO] Mô hình đã sẵn sàng!\n")
    return tokenizer, model


def predict_sentence_probs(sentence: str, tokenizer, model) -> tuple:
    """Predict emotion probability array for a single sentence."""
    cleaned_sent = preprocess_single_sentence(sentence, apply_word_tokenize=True)
    inputs = tokenizer(cleaned_sent, return_tensors="pt", padding=True, truncation=True, max_length=128).to(DEVICE)
    
    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=1)[0].cpu().numpy()
        
    return probs, cleaned_sent


def predict_multi_label_emotion(text: str, tokenizer, model, alpha: float = 0.5, min_sentence_words: int = 2) -> dict:
    """
    Multi-Label Emotion Inference Engine (Primary & Secondary Emotion Extraction).
    1. Sentence-Splitting & Noise Filtering (underthesea sent_tokenize + Short sentence filter)
    2. Per-Sentence PhoBERT Prediction with Word Segmentation
    3. Weighted Hybrid Pooling (Combines Peak Emotion, Sentence Length Weighting & Overall Tone)
    4. Dynamic Soft Multi-Label Extraction: Relative Thresholding based on Primary Emotion Score
    """
    # 1. Split text into sentences
    if HAS_UNDERTHESEA:
        raw_sentences = sent_tokenize(text)
    else:
        raw_sentences = [s.strip() for s in text.replace(".", "\n").split("\n") if s.strip()]

    if not raw_sentences:
        raw_sentences = [text]

    # Filter out empty or noise sentences, but fallback to raw if all filtered
    filtered_sentences = [s for s in raw_sentences if len(s.strip().split()) >= min_sentence_words]
    if not filtered_sentences:
        filtered_sentences = raw_sentences

    sentence_details = []
    prob_list = []
    sentence_weights = []

    # 2. Predict probabilities for each sentence
    for sent in filtered_sentences:
        probs, processed_sent = predict_sentence_probs(sent, tokenizer, model)
        prob_list.append(probs)
        
        # Weight sentence by word count (log-scaled to prevent extreme domination)
        word_cnt = len(processed_sent.split())
        weight = np.log1p(word_cnt)
        sentence_weights.append(weight)

        top_id = int(np.argmax(probs))
        sentence_details.append({
            "raw_sentence": sent,
            "processed_sentence": processed_sent,
            "predicted_label": LABEL_NAMES[top_id],
            "confidence": float(probs[top_id]),
            "word_count": word_cnt
        })

    prob_matrix = np.array(prob_list) # shape: (N_sentences, 7)
    weights_arr = np.array(sentence_weights)
    sum_weights = np.sum(weights_arr)
    if sum_weights > 0:
        normalized_weights = weights_arr / sum_weights
    else:
        normalized_weights = np.ones(len(filtered_sentences)) / len(filtered_sentences)

    # 3. Weighted Hybrid Pooling (Peak Emotion + Length-Weighted Average Tone)
    max_probs = np.max(prob_matrix, axis=0)
    weighted_avg_probs = np.sum(prob_matrix * normalized_weights[:, np.newaxis], axis=0)
    
    final_probs = alpha * max_probs + (1 - alpha) * weighted_avg_probs
    
    # Normalize probabilities to sum up to 1.0
    final_probs = final_probs / np.sum(final_probs)

    # 4. Dynamic Multi-Label Classification Extraction (Primary & Secondary)
    sorted_indices = np.argsort(final_probs)[::-1] # Sort descending
    
    primary_id = int(sorted_indices[0])
    primary_label = LABEL_NAMES[primary_id]
    primary_score = float(final_probs[primary_id])
    
    # Dynamic Threshold: Secondary threshold scales relative to primary score (min 10%, max 50% of primary)
    dynamic_threshold = max(0.10, primary_score * 0.45)

    secondary_emotions = []
    for idx in sorted_indices[1:]:
        score = float(final_probs[idx])
        # Include as secondary emotion if score meets dynamic threshold and is not "Other"
        if score >= dynamic_threshold and LABEL_NAMES[idx] != "Other":
            secondary_emotions.append({
                "label": LABEL_NAMES[idx],
                "vietnamese_label": LABEL_TRANSLATIONS[LABEL_NAMES[idx]],
                "score": score
            })

    prob_dict = {LABEL_NAMES[i]: float(final_probs[i]) for i in range(len(LABEL_NAMES))}

    return {
        "raw_text": text,
        "total_sentences": len(filtered_sentences),
        "primary_emotion": {
            "label": primary_label,
            "vietnamese_label": LABEL_TRANSLATIONS[primary_label],
            "score": primary_score
        },
        "secondary_emotions": secondary_emotions,
        "dynamic_threshold_used": dynamic_threshold,
        "is_multi_faceted": len(secondary_emotions) > 0,
        "probabilities": prob_dict,
        "sentence_timeline": sentence_details
    }


def main():
    tokenizer, model = load_fine_tuned_model()
    print("=" * 75)
    print("  PHOBERT MULTI-LABEL EMOTION ENGINE (NHÃN CHÍNH & NHÃN PHỤ)")
    print("  Tự động trích xuất Cảm xúc Chủ đạo (Primary) và Cảm xúc Bổ trợ (Secondary)")
    print("  Gõ 'exit' hoặc 'quit' để thoát chương trình.")
    print("=" * 75 + "\n")

    while True:
        try:
            user_input = input("👉 Nhập bài viết/câu tiếng Việt: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit", "q"]:
                print("\nCảm ơn bạn đã sử dụng chương trình!")
                break

            res = predict_multi_label_emotion(user_input, tokenizer, model)

            print("\n" + "=" * 65)
            print(f"📝 Số câu phân tích : {res['total_sentences']} câu")
            print(f"🎯 CẢM XÚC CHÍNH (Primary)  : {res['primary_emotion']['vietnamese_label']} ({res['primary_emotion']['score']*100:.2f}%)")
            
            if res["is_multi_faceted"]:
                print("🌟 CẢM XÚC PHỤ (Secondary):")
                for sec in res["secondary_emotions"]:
                    print(f"   ➔ {sec['vietnamese_label']} ({sec['score']*100:.2f}%)")
            else:
                print("🌟 CẢM XÚC PHỤ (Secondary): (Không có cảm xúc phụ đáng kể)")
            print("=" * 65)

            print("\n📍 Sơ đồ cảm xúc từng câu (Emotion Timeline):")
            for idx, item in enumerate(res['sentence_timeline'], 1):
                print(f"  [{idx}] \"{item['processed_sentence']}\"")
                print(f"      ➔ Cảm xúc câu: {LABEL_TRANSLATIONS[item['predicted_label']]} ({item['confidence']*100:.1f}%)")

            print("\n📊 Phân bố xác suất toàn cục 7 lớp cảm xúc:")
            for label, prob in res["probabilities"].items():
                bar = "█" * int(prob * 20)
                is_pri = " [CHÍNH]" if label == res['primary_emotion']['label'] else ""
                is_sec = " [PHỤ]" if any(s['label'] == label for s in res['secondary_emotions']) else ""
                tag = is_pri or is_sec
                print(f" - {label:<10}: {prob * 100:6.2f}% {bar}{tag}")
            print("=" * 65 + "\n")

        except KeyboardInterrupt:
            print("\nĐã dừng chương trình!")
            break


if __name__ == "__main__":
    main()
