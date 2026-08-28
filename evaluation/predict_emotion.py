import os
import sys
import torch
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification

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

# Path to your local Fine-Tuned Model Weights
MODEL_PATH = eval_dir / "weights" / "phobert_emotion_final"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

LABEL_NAMES = ["Enjoyment", "Sadness", "Disgust", "Anger", "Fear", "Surprise", "Other"]

# Friendly Vietnamese translation of emotion labels
LABEL_TRANSLATIONS = {
    "Enjoyment": "😊 Vui vẻ / Yêu thích (Enjoyment)",
    "Sadness": "😭 Buồn rầu / Thất vọng (Sadness)",
    "Disgust": "🤮 Chán ghét / Khinh bỉ (Disgust)",
    "Anger": "😡 Tức giận / Bực mình (Anger)",
    "Fear": "😱 Sợ hãi / Lo lắng (Fear)",
    "Surprise": "😲 Ngạc nhiên / Bất ngờ (Surprise)",
    "Other": "😐 Khác / Trung tính (Other)"
}


def preprocess_input_text(text: str) -> str:
    """Clean and normalize Vietnamese input text."""
    if HAS_PIPELINE:
        text = social_text_cleaner.clean(text)
        text = teencode_normalizer.normalize(text)
    text = " ".join(text.split())
    return text


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


def predict_emotion(text: str, tokenizer, model) -> dict:
    """Predict emotion label and probabilities for a single text."""
    cleaned_text = preprocess_input_text(text)
    inputs = tokenizer(cleaned_text, return_tensors="pt", padding=True, truncation=True, max_length=256).to(DEVICE)
    
    with torch.no_grad():
        outputs = model(**inputs)
        probs = torch.softmax(outputs.logits, dim=1)[0]
    
    pred_id = torch.argmax(probs).item()
    pred_label = LABEL_NAMES[pred_id]
    confidence = probs[pred_id].item()

    # Detailed probabilities for all 7 classes
    prob_dict = {LABEL_NAMES[i]: probs[i].item() for i in range(len(LABEL_NAMES))}
    
    return {
        "raw_text": text,
        "cleaned_text": cleaned_text,
        "predicted_label": pred_label,
        "vietnamese_label": LABEL_TRANSLATIONS[pred_label],
        "confidence": confidence,
        "probabilities": prob_dict
    }


def main():
    tokenizer, model = load_fine_tuned_model()
    print("=" * 65)
    print("  CHƯƠNG TRÌNH DỰ ĐOÁN CẢM XÚC TIẾNG VIỆT (PHOBERT FINE-TUNED)")
    print("  Gõ 'exit' hoặc 'quit' để thoát chương trình.")
    print("=" * 65 + "\n")

    while True:
        try:
            user_input = input("👉 Nhập câu tiếng Việt: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ["exit", "quit", "q"]:
                print("\nCảm ơn bạn đã sử dụng chương trình!")
                break

            res = predict_emotion(user_input, tokenizer, model)

            print("\n" + "-" * 50)
            print(f"📝 Văn bản gốc     : {res['raw_text']}")
            print(f"✨ Văn bản đã xử lý : {res['cleaned_text']}")
            print(f"🎯 Cảm xúc dự đoán  : {res['vietnamese_label']}")
            print(f"📊 Độ tin cậy (Conf): {res['confidence'] * 100:.2f}%")
            print("-" * 50)
            print("Phân bố xác suất 7 lớp cảm xúc:")
            for label, prob in res["probabilities"].items():
                bar = "█" * int(prob * 20)
                print(f" - {label:<10}: {prob * 100:6.2f}% {bar}")
            print("=" * 50 + "\n")

        except KeyboardInterrupt:
            print("\nĐã dừng chương trình!")
            break


if __name__ == "__main__":
    main()
