import os
import argparse
from pathlib import Path
from huggingface_hub import HfApi, create_repo

DEFAULT_REPO_ID = "huyleit/phobert-vi-emotion-v1.1"


def generate_model_card(report_md_path: Path) -> str:
    benchmark_table = ""
    if report_md_path.exists():
        with open(report_md_path, "r", encoding="utf-8") as f:
            benchmark_table = f.read()
    else:
        benchmark_table = "Xem chi tiết tại test_log.txt."

    return f"""---
language:
- vi
license: mit
tags:
- emotion-classification
- phobert
- pytorch
- onnx
- transformers
- social-media
pipeline_tag: text-classification
widget:
- text: "Tôi cảm thấy rất vui và hạnh phúc khi làm việc hôm nay."
- text: "Quá thất vọng với thái độ phục vụ lồi lõm này."
- text: "Thật sự rất sốc và không thể tin nổi chuyện này lại xảy ra!"
---

# PhoBERT Emotion Recognition v1.1 (Multi-Format: PyTorch + ONNX FP32 & INT8)

Mô hình phân loại cảm xúc tiếng Việt 7 nhãn (*Enjoyment, Sadness, Disgust, Anger, Fear, Surprise, Other*) được tinh chỉnh (Fine-Tuned) từ `vinai/phobert-base-v2` trên ngữ liệu tăng cường cân bằng (11,193 mẫu).

## 1. Định Dạng Cung Cấp
* **PyTorch (`model.safetensors`)**: Trọng số gốc tiêu chuẩn FP32.
* **ONNX FP32 (`onnx/phobert_emotion_fp32.onnx`)**: Bảo toàn 100% độ chính xác, tăng tốc CPU 23%.
* **ONNX INT8 (`onnx/phobert_emotion_int8.onnx`)**: Lượng tử hóa động (Dynamic Quantization), **tiết kiệm 74.8% dung lượng đĩa (129 MB) và 70% RAM**, độ trễ chỉ **~63.9ms/câu**.

## 2. Hướng Dẫn Sử Dụng Nhanh

### PyTorch (Transformers)
```python
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

model_id = "huyleit/phobert-vi-emotion-v1.1"
tokenizer = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForSequenceClassification.from_pretrained(model_id)

text = "Hôm nay nhận được tin vui quá trời luôn!"
inputs = tokenizer(text, return_tensors="pt", max_length=128, truncation=True)
with torch.no_grad():
    logits = model(**inputs).logits
pred_label = torch.argmax(logits, dim=1).item()
# Labels: 0: Enjoyment, 1: Sadness, 2: Disgust, 3: Anger, 4: Fear, 5: Surprise, 6: Other
```

### ONNX Runtime (CPU Fast Inference)
```python
import onnxruntime as ort
from transformers import AutoTokenizer
import numpy as np

tokenizer = AutoTokenizer.from_pretrained("huyleit/phobert-vi-emotion-v1.1")
session = ort.InferenceSession("onnx/phobert_emotion_int8.onnx", providers=["CPUExecutionProvider"])

text = "Hôm nay nhận được tin vui quá trời luôn!"
inputs = tokenizer(text, return_tensors="np", max_length=128, truncation=True)
outputs = session.run(["logits"], {{"input_ids": inputs["input_ids"], "attention_mask": inputs["attention_mask"]}})
pred_label = int(np.argmax(outputs[0], axis=1)[0])
```

---

{benchmark_table}
"""


def upload_v1_1_to_hf(repo_id: str = DEFAULT_REPO_ID, token: str = None):
    hf_token = token or os.getenv("HF_TOKEN")
    if not hf_token:
        print("⚠️ Không tìm thấy biến môi trường HF_TOKEN.")
        hf_token = input("👉 Nhập Hugging Face Write Token: ").strip()

    if not hf_token:
        raise ValueError("HF Token không được để trống!")

    api = HfApi(token=hf_token)
    weights_dir = Path(__file__).resolve().parent.parent / "weights" / "phobert_emotion_v1.1"
    report_md_path = weights_dir / "reports" / "phobert_onnx_benchmark_report.md"
    readme_path = weights_dir / "README.md"

    # 1. Kiểm tra Model Card README.md
    print(f"\n[1/3] Checking Model Card README.md at: {readme_path} ...")
    if not readme_path.exists():
        readme_content = generate_model_card(report_md_path)
        with open(readme_path, "w", encoding="utf-8") as f:
            f.write(readme_content)
        print("      ✓ Model card generated.")
    else:
        print("      ✓ Model card already customized. Keeping existing README.md.")

    # 2. Tạo Repo nếu chưa tồn tại
    print(f"\n[2/3] Checking / Creating Hugging Face repository: {repo_id} ...")
    create_repo(repo_id=repo_id, token=hf_token, repo_type="model", exist_ok=True)
    print(f"      ✓ Repo {repo_id} is ready.")

    # 3. Upload toàn bộ thư mục (bao gồm cả PyTorch và thư mục onnx/)
    print(f"\n[3/3] Uploading model folder: {weights_dir} -> {repo_id} ...")
    print("      (Quá trình này sẽ mất khoảng 1-2 phút tùy tốc độ mạng)")

    api.upload_folder(
        folder_path=str(weights_dir),
        repo_id=repo_id,
        repo_type="model",
        ignore_patterns=["reports/*", "onnx/*.txt", "onnx/*.codes", "onnx/*.json"],
        commit_message="Release PhoBERT Emotion v1.1 (PyTorch + ONNX FP32 & INT8 Quantized)",
    )

    print("\n" + "=" * 65)
    print(f"🎉 UPLOAD THÀNH CÔNG LÊN HUGGING FACE!")
    print(f"🔗 Xem mô hình tại: https://huggingface.co/{repo_id}")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload PhoBERT Emotion v1.1 to Hugging Face")
    parser.add_argument("--repo-id", type=str, default=DEFAULT_REPO_ID, help="Hugging Face target repo ID")
    parser.add_argument("--token", type=str, default=None, help="Hugging Face Write Token")
    args = parser.parse_args()

    upload_v1_1_to_hf(repo_id=args.repo_id, token=args.token)
