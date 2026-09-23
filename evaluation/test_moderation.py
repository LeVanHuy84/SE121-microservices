import argparse
import os
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

# Cấu hình UTF-8 cho Windows Console
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Thư mục gốc weights
BASE_DIR = Path(__file__).resolve().parent
WEIGHTS_DIR = BASE_DIR / "weights"

MODEL_PATHS = {
    "pytorch": WEIGHTS_DIR / "phobert_moderation_v1.1",
    "onnx_fp32": WEIGHTS_DIR / "phobert_moderation_fp32.onnx",
    "onnx_int8": WEIGHTS_DIR / "phobert_moderation_int8.onnx",
    "tokenizer": WEIGHTS_DIR / "phobert_moderation_v1.1",
}

LABEL_NAMES = ["CLEAN", "PROFANITY_VENTING", "HATE_SPEECH", "EMOTIONAL_CRISIS"]

LABEL_DESCRIPTIONS = {
    "CLEAN": "Nội dung an toàn, bình thường",
    "PROFANITY_VENTING": "Từ ngữ nhạy cảm / Xả giận (Venting)",
    "HATE_SPEECH": "Ngôn từ thù ghét / Xúc phạm độc hại",
    "EMOTIONAL_CRISIS": "Khủng hoảng tâm lý / Cầu cứu / Tiêu cực nặng",
}

ACTION_MAP = {
    "CLEAN": "ALLOW (Cho phép đăng công khai)",
    "PROFANITY_VENTING": "ALLOW_WITH_WARNING (Đăng + Gắn nhãn cảnh báo nhạy cảm)",
    "HATE_SPEECH": "HARD_BLOCK (Chặn bài viết vi phạm tiêu chuẩn cộng đồng)",
    "EMOTIONAL_CRISIS": "ALLOW_WITH_SUPPORT (Đăng + Kích hoạt hỗ trợ tâm lý khẩn cấp)",
}


def softmax(x: np.ndarray) -> np.ndarray:
    """Tính toán softmax an toàn cho mảng numpy."""
    e_x = np.exp(x - np.max(x))
    return e_x / e_x.sum(axis=-1, keepdims=True)


def create_progress_bar(val: float, total: float = 1.0, width: int = 24) -> str:
    """Tạo thanh hiển thị phần trăm trực quan."""
    ratio = min(max(val / total, 0.0), 1.0)
    filled_len = int(round(width * ratio))
    bar = "█" * filled_len + "░" * (width - filled_len)
    return bar


class ModerationEvaluator:
    def __init__(self):
        self.tokenizer = None
        self.pytorch_model = None
        self.onnx_fp32_session = None
        self.onnx_int8_session = None
        self.torch_device = "cpu"
        self._check_weights()
        self._load_tokenizer()

    def _check_weights(self):
        """Kiểm tra sự tồn tại của các file mô hình."""
        missing = []
        for name, path in MODEL_PATHS.items():
            if not path.exists():
                missing.append(f"  - {name}: {path}")
        if missing:
            print("[CẢNH BÁO] Không tìm thấy một số file mô hình:")
            for m in missing:
                print(m)
            print()

    def _load_tokenizer(self):
        """Khởi tạo Tokenizer từ local folder."""
        tokenizer_path = MODEL_PATHS["tokenizer"]
        if not tokenizer_path.exists():
            raise FileNotFoundError(f"Không tìm thấy thư mục tokenizer tại: {tokenizer_path}")
        
        from transformers import AutoTokenizer
        print(f"[*] Đang nạp Tokenizer từ: {tokenizer_path.name}...")
        self.tokenizer = AutoTokenizer.from_pretrained(str(tokenizer_path))

    def get_pytorch_model(self):
        """Nạp mô hình PyTorch FP32."""
        if self.pytorch_model is None:
            import torch
            from transformers import AutoModelForSequenceClassification

            path = MODEL_PATHS["pytorch"]
            if not path.exists():
                raise FileNotFoundError(f"Không tìm thấy PyTorch weights tại: {path}")

            self.torch_device = "cuda" if torch.cuda.is_available() else "cpu"
            print(f"[*] Đang tải PyTorch FP32 model ({self.torch_device.upper()})...")
            model = AutoModelForSequenceClassification.from_pretrained(str(path))
            model.to(self.torch_device)
            model.eval()
            self.pytorch_model = model
            print("[✓] Đã nạp PyTorch model thành công!")
        return self.pytorch_model

    def get_onnx_session(self, model_type: str = "onnx_fp32"):
        """Nạp ONNX InferenceSession (FP32 hoặc INT8)."""
        import onnxruntime as ort

        if model_type == "onnx_fp32":
            if self.onnx_fp32_session is None:
                path = MODEL_PATHS["onnx_fp32"]
                if not path.exists():
                    raise FileNotFoundError(f"Không tìm thấy ONNX FP32 tại: {path}")
                print(f"[*] Đang khởi tạo ONNX Runtime FP32 Session...")
                sess_opts = ort.SessionOptions()
                sess_opts.intra_op_num_threads = 4
                sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                self.onnx_fp32_session = ort.InferenceSession(
                    str(path), sess_options=sess_opts, providers=["CPUExecutionProvider"]
                )
                print("[✓] Đã nạp ONNX FP32 Session thành công!")
            return self.onnx_fp32_session
        elif model_type == "onnx_int8":
            if self.onnx_int8_session is None:
                path = MODEL_PATHS["onnx_int8"]
                if not path.exists():
                    raise FileNotFoundError(f"Không tìm thấy ONNX INT8 tại: {path}")
                print(f"[*] Đang khởi tạo ONNX Runtime INT8 Session...")
                sess_opts = ort.SessionOptions()
                sess_opts.intra_op_num_threads = 4
                sess_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
                self.onnx_int8_session = ort.InferenceSession(
                    str(path), sess_options=sess_opts, providers=["CPUExecutionProvider"]
                )
                print("[✓] Đã nạp ONNX INT8 Session thành công!")
            return self.onnx_int8_session
        else:
            raise ValueError(f"Loại ONNX model không hợp lệ: {model_type}")

    def predict_pytorch(self, text: str, max_length: int = 128) -> Tuple[np.ndarray, float]:
        """Dự đoán bằng PyTorch FP32."""
        import torch

        model = self.get_pytorch_model()
        inputs = self.tokenizer(
            text, return_tensors="pt", truncation=True, max_length=max_length, padding=True
        ).to(self.torch_device)

        start_time = time.perf_counter()
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits.cpu().numpy()[0]
        latency_ms = (time.perf_counter() - start_time) * 1000

        probs = softmax(logits)
        return probs, latency_ms

    def predict_onnx(self, text: str, model_type: str = "onnx_fp32", max_length: int = 128) -> Tuple[np.ndarray, float]:
        """Dự đoán bằng ONNX Session (FP32 hoặc INT8)."""
        session = self.get_onnx_session(model_type)
        inputs = self.tokenizer(
            text, return_tensors="np", truncation=True, max_length=max_length, padding=True
        )

        start_time = time.perf_counter()
        ort_inputs = {
            "input_ids": inputs["input_ids"],
            "attention_mask": inputs["attention_mask"],
        }
        outputs = session.run(["logits"], ort_inputs)
        logits = outputs[0][0]
        latency_ms = (time.perf_counter() - start_time) * 1000

        probs = softmax(logits)
        return probs, latency_ms

    def predict(self, text: str, model_choice: str) -> Tuple[np.ndarray, float, str]:
        """Gọi hàm phân tích theo lựa chọn mô hình."""
        if model_choice == "pytorch":
            probs, latency_ms = self.predict_pytorch(text)
            model_name = f"PyTorch FP32 ({self.torch_device.upper()})"
        elif model_choice == "onnx_fp32":
            probs, latency_ms = self.predict_onnx(text, model_type="onnx_fp32")
            model_name = "ONNX Runtime FP32 (CPU)"
        elif model_choice == "onnx_int8":
            probs, latency_ms = self.predict_onnx(text, model_type="onnx_int8")
            model_name = "ONNX Runtime INT8 Quantized (CPU)"
        else:
            raise ValueError(f"Lựa chọn mô hình không hợp lệ: {model_choice}")

        return probs, latency_ms, model_name


def print_result_card(text: str, probs: np.ndarray, latency_ms: float, model_name: str):
    """In bảng kết quả phân tích kiểm duyệt chi tiết và trực quan."""
    class_id = int(np.argmax(probs))
    confidence = float(probs[class_id])
    pred_label = LABEL_NAMES[class_id]
    action = ACTION_MAP.get(pred_label, "UNKNOWN")
    desc = LABEL_DESCRIPTIONS.get(pred_label, "")

    print("\n" + "=" * 75)
    print(f"📌 BÀI VIẾT: \"{text}\"")
    print(f"⚙️  MÔ HÌNH : {model_name}")
    print(f"⏱️  ĐỘ TRỄ  : {latency_ms:.2f} ms")
    print("-" * 75)
    print(f"🎯 KẾT QUẢ PHÂN TÍCH:")
    print(f"   • Nhãn dự đoán : {pred_label} (ID: {class_id}) - {desc}")
    print(f"   • Độ tự tin    : {confidence * 100:.2f}%")
    print(f"   • Quyết định   : 🛡️ {action}")
    print("-" * 75)
    print("📊 XÁC SUẤT CHI TIẾT CÁC NHÃN:")
    for i, label in enumerate(LABEL_NAMES):
        prob = probs[i]
        bar = create_progress_bar(prob, width=22)
        star = " 👈 (Top)" if i == class_id else ""
        print(f"   [{i}] {label:<18} | {bar} | {prob * 100:6.2f}%{star}")
    print("=" * 75 + "\n")


def compare_all_models(evaluator: ModerationEvaluator, text: str):
    """Chạy đồng thời cả 3 mô hình trên cùng text input để so sánh kết quả và hiệu năng."""
    print("\n" + "=" * 80)
    print(f"🔬 SO SÁNH ĐỒNG THỜI CẢ 3 MÔ HÌNH CHO TEXT: \"{text}\"")
    print("=" * 80)

    models = [
        ("pytorch", "PyTorch FP32"),
        ("onnx_fp32", "ONNX FP32"),
        ("onnx_int8", "ONNX INT8 (Quantized)"),
    ]

    results = []
    for model_key, label_display in models:
        try:
            probs, latency, name = evaluator.predict(text, model_key)
            class_id = int(np.argmax(probs))
            results.append({
                "key": model_key,
                "display": name,
                "label": LABEL_NAMES[class_id],
                "conf": probs[class_id] * 100,
                "latency": latency,
                "probs": probs,
            })
        except Exception as e:
            results.append({
                "key": model_key,
                "display": label_display,
                "error": str(e),
            })

    # In bảng so sánh ngắn gọn
    print(f"{'Mô hình':<28} | {'Nhãn dự đoán':<18} | {'Tự tin':<10} | {'Độ trễ':<12}")
    print("-" * 80)
    for r in results:
        if "error" in r:
            print(f"{r['display']:<28} | [LỖI: {r['error']}]")
        else:
            print(f"{r['display']:<28} | {r['label']:<18} | {r['conf']:>6.2f}%    | {r['latency']:>6.2f} ms")
    print("=" * 80 + "\n")


def select_model_menu() -> str:
    """Menu chọn loại mô hình."""
    options = {
        "1": "pytorch",
        "2": "onnx_fp32",
        "3": "onnx_int8",
        "4": "compare",
    }

    print("\n" + "=" * 55)
    print("         CHỌN LOẠI MÔ HÌNH KIỂM DUYỆT (MODERATION)")
    print("=" * 55)
    print("  [1] PyTorch FP32       (phobert_moderation_v1.1)")
    print("  [2] ONNX FP32          (phobert_moderation_fp32.onnx)")
    print("  [3] ONNX INT8          (phobert_moderation_int8.onnx)")
    print("  [4] Chế độ so sánh     (Chạy cả 3 mô hình cùng lúc)")
    print("  [q] Thoát chương trình")
    print("=" * 55)

    while True:
        choice = input("👉 Nhập lựa chọn [1-4] (mặc định [2] ONNX FP32): ").strip().lower()
        if not choice:
            return "onnx_fp32"
        if choice in ["q", "exit", "quit"]:
            sys.exit(0)
        if choice in options:
            return options[choice]
        print("⚠️ Lựa chọn không hợp lệ, vui lòng chọn từ 1 đến 4 hoặc gõ 'q'.")


def main():
    parser = argparse.ArgumentParser(description="Kiểm thử mô hình PhoBERT Moderation (PyTorch / ONNX FP32 / ONNX INT8)")
    parser.add_argument(
        "-m", "--model",
        choices=["pytorch", "onnx_fp32", "onnx_int8", "compare"],
        default=None,
        help="Loại mô hình kiểm thử: pytorch, onnx_fp32, onnx_int8 hoặc compare",
    )
    parser.add_argument(
        "-t", "--text",
        type=str,
        default=None,
        help="Nội dung bài viết cần phân tích trực tiếp từ command line",
    )
    args = parser.parse_args()

    evaluator = ModerationEvaluator()

    # Chọn mô hình
    current_model = args.model
    if current_model is None:
        current_model = select_model_menu()

    # Nếu người dùng truyền sẵn text qua tham số CLI
    if args.text:
        if current_model == "compare":
            compare_all_models(evaluator, args.text)
        else:
            probs, latency, name = evaluator.predict(args.text, current_model)
            print_result_card(args.text, probs, latency, name)
        return

    # Vòng lặp tương tác nhập text (Interactive REPL)
    print("\n" + "=" * 65)
    print(f"🚀 Chế độ phân tích đang chọn: [{current_model.upper()}]")
    print("💡 Lệnh hỗ trợ:")
    print("   • Nhập câu bất kỳ để phân tích kiểm duyệt")
    print("   • Gõ 'm' hoặc 'switch' để đổi loại mô hình")
    print("   • Gõ 'c' hoặc 'compare' để bật chế độ so sánh cả 3 mô hình")
    print("   • Gõ 'q' hoặc 'exit' để thoát")
    print("=" * 65 + "\n")

    while True:
        try:
            user_input = input(f"[{current_model}] 👉 Nhập bài viết: ").strip()
            if not user_input:
                continue

            cmd = user_input.lower()
            if cmd in ["q", "exit", "quit"]:
                print("[*] Tạm biệt!")
                break
            elif cmd in ["m", "switch"]:
                current_model = select_model_menu()
                print(f"\n[✓] Đã chuyển sang mô hình: [{current_model.upper()}]\n")
                continue
            elif cmd in ["c", "compare"]:
                current_model = "compare"
                print("\n[✓] Đã chuyển sang chế độ SO SÁNH 3 MÔ HÌNH\n")
                continue

            if current_model == "compare":
                compare_all_models(evaluator, user_input)
            else:
                probs, latency, name = evaluator.predict(user_input, current_model)
                print_result_card(user_input, probs, latency, name)

        except KeyboardInterrupt:
            print("\n[*] Tạm biệt!")
            break
        except Exception as err:
            print(f"\n❌ Đã xảy ra lỗi khi phân tích: {err}\n")


if __name__ == "__main__":
    main()
