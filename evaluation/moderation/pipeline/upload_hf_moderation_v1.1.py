import os
import argparse
from pathlib import Path
from huggingface_hub import HfApi, create_repo

DEFAULT_REPO_ID = "huyleit/phobert-vi-moderation-v1.1"


def upload_moderation_v1_1_to_hf(repo_id: str = DEFAULT_REPO_ID, token: str = None):
    hf_token = token or os.getenv("HF_TOKEN")
    if not hf_token:
        print("⚠️ Không tìm thấy biến môi trường HF_TOKEN.")
        hf_token = input("👉 Nhập Hugging Face Write Token: ").strip()

    if not hf_token:
        raise ValueError("HF Token không được để trống!")

    api = HfApi(token=hf_token)
    weights_dir = Path(__file__).resolve().parents[2] / "weights" / "phobert_moderation_v1.1"
    readme_path = weights_dir / "README.md"

    if not readme_path.exists():
        raise FileNotFoundError(f"Chưa tìm thấy README.md tại {readme_path}")

    # 1. Tạo Repo nếu chưa tồn tại
    print(f"\n[1/2] Checking / Creating Hugging Face repository: {repo_id} ...")
    create_repo(repo_id=repo_id, token=hf_token, repo_type="model", exist_ok=True)
    print(f"      ✓ Repo {repo_id} is ready.")

    # 2. Upload toàn bộ thư mục weights (PyTorch safetensors, config, tokenizer và thư mục con onnx/)
    print(f"\n[2/2] Uploading model folder: {weights_dir} -> {repo_id} ...")
    print("      (Quá trình upload PyTorch + ONNX FP32 + ONNX INT8 sẽ mất khoảng 1-2 phút tùy tốc độ mạng)")

    api.upload_folder(
        folder_path=str(weights_dir),
        repo_id=repo_id,
        repo_type="model",
        ignore_patterns=["reports/*", "onnx/*.txt", "onnx/*.codes"],
        commit_message="Fix cleaned dataset & update PhoBERT Moderation v1.1 weights (PyTorch + ONNX FP32 & INT8)",
    )

    print("\n" + "=" * 65)
    print(f"🎉 UPLOAD THÀNH CÔNG LÊN HUGGING FACE!")
    print(f"🔗 Xem mô hình tại: https://huggingface.co/{repo_id}")
    print("=" * 65)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Upload PhoBERT Moderation v1.1 to Hugging Face")
    parser.add_argument("--repo-id", type=str, default=DEFAULT_REPO_ID, help="Hugging Face target repo ID")
    parser.add_argument("--token", type=str, default=None, help="Hugging Face Write Token")
    args = parser.parse_args()

    upload_moderation_v1_1_to_hf(repo_id=args.repo_id, token=args.token)
