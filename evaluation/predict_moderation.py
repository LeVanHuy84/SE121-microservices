import os
import sys
import torch
import numpy as np
from pathlib import Path
from transformers import AutoTokenizer, AutoModelForSequenceClassification

# UTF-8 Encoding cho Console Windows
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Đường dẫn local weights phobert_moderation_v1.1
MODEL_PATH = Path(__file__).parent / "weights" / "phobert_moderation_v1.1"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

LABEL_NAMES = ["CLEAN", "PROFANITY_VENTING", "HATE_SPEECH", "EMOTIONAL_CRISIS"]

# Đồ thị quyết định hành vi hệ thống tương ứng
ACTION_MAP = {
    "CLEAN": "ALLOW (Cho phép đăng)",
    "PROFANITY_VENTING": "ALLOW_WITH_WARNING (Đăng + Gắn nhãn cảnh báo)",
    "HATE_SPEECH": "HARD_BLOCK (Chặn bài vi phạm)",
    "EMOTIONAL_CRISIS": "ALLOW_WITH_SUPPORT (Đăng + Kích hoạt Hỗ trợ Tâm lý)"
}


def main():
    if not MODEL_PATH.exists():
        print(f"[LỖI] Không tìm thấyweights tại: {MODEL_PATH}")
        return

    print(f"[*] Đang tải mô hình PhoBERT Moderation v1.1 từ: {MODEL_PATH} ({DEVICE.upper()})...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_PATH))
    model = AutoModelForSequenceClassification.from_pretrained(str(MODEL_PATH))
    model.to(DEVICE)
    model.eval()
    print("[*] Tải mô hình thành công! Nhập câu để kiểm thử (gõ 'q' hoặc 'exit' để thoát).\n")

    while True:
        try:
            text = input("👉 Nhập bài viết: ").strip()
            if not text:
                continue
            if text.lower() in ["exit", "quit", "q"]:
                break

            inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=256, padding=True).to(DEVICE)
            with torch.no_grad():
                logits = model(**inputs).logits
                probs = torch.softmax(logits, dim=-1)[0].cpu().numpy()

            class_id = int(np.argmax(probs))
            confidence = float(probs[class_id])
            pred_label = LABEL_NAMES[class_id]
            action = ACTION_MAP.get(pred_label, "ALLOW")

            print("-" * 60)
            print(f"🎯 Nhãn dự đoán : {pred_label} (Mã: {class_id})")
            print(f"📊 Độ tự tin    : {confidence * 100:.2f}%")
            print(f"⚡ Quyết định   : {action}")
            print("📈 Xác suất chi tiết:")
            for i, label_name in enumerate(LABEL_NAMES):
                print(f"   - {label_name:<18}: {probs[i] * 100:6.2f}%")
            print("-" * 60 + "\n")

        except KeyboardInterrupt:
            break


if __name__ == "__main__":
    main()
