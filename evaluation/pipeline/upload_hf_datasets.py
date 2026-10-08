import os
import sys
import json
import argparse
from pathlib import Path
from huggingface_hub import HfApi, create_repo

# Thư mục gốc project
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
EVAL_DIR = PROJECT_ROOT / "evaluation"

# Cấu hình 2 datasets
DATASET_CONFIGS = {
    "emotion": {
        "default_repo_id": "huyleit/vietnamese-social-emotion",
        "description": "Vietnamese Social Media Emotion Recognition Dataset (7 classes: Enjoyment, Sadness, Disgust, Anger, Fear, Surprise, Other)",
        "source_files": [
            EVAL_DIR / "data" / "phobert_train.json",
            EVAL_DIR / "data" / "phobert_val.json",
            EVAL_DIR / "data" / "phobert_test.json",
            EVAL_DIR / "data" / "phobert_finetune_merged_dataset.json",
        ],
        "target_file_mapping": {
            "phobert_train.json": "train.json",
            "phobert_val.json": "val.json",
            "phobert_test.json": "test.json",
            "phobert_finetune_merged_dataset.json": "merged_dataset.json",
        },
        "tags": [
            "emotion-classification",
            "vietnamese",
            "social-media",
            "phobert",
            "nlp",
        ],
        "labels": {
            0: "Enjoyment",
            1: "Sadness",
            2: "Disgust",
            3: "Anger",
            4: "Fear",
            5: "Surprise",
            6: "Other",
        },
        "stats": {
            "total": 11193,
            "train": 7835,
            "val": 1679,
            "test": 1679,
        },
    },
    "moderation": {
        "default_repo_id": "huyleit/vietnamese-social-moderation",
        "description": "Vietnamese Social Media Content Moderation Dataset (4 classes: CLEAN, PROFANITY_VENTING, HATE_SPEECH, SELF_HARM_CRISIS)",
        "source_files": [
            EVAL_DIR / "moderation" / "data" / "v1.1" / "train.json",
            EVAL_DIR / "moderation" / "data" / "v1.1" / "val.json",
            EVAL_DIR / "moderation" / "data" / "v1.1" / "test.json",
            EVAL_DIR / "moderation" / "data" / "v1.1" / "merged_moderation_dataset_v1.1.json",
        ],
        "target_file_mapping": {
            "train.json": "train.json",
            "val.json": "val.json",
            "test.json": "test.json",
            "merged_moderation_dataset_v1.1.json": "merged_dataset.json",
        },
        "tags": [
            "content-moderation",
            "hate-speech",
            "vietnamese",
            "social-media",
            "toxic-comment",
            "safety",
        ],
        "labels": {
            0: "CLEAN",
            1: "PROFANITY_VENTING",
            2: "HATE_SPEECH",
            3: "SELF_HARM_CRISIS",
        },
        "stats": {
            "total": 16270,
            "train": 11389,
            "val": 2440,
            "test": 2441,
        },
    },
}


def generate_dataset_card(cfg: dict, dataset_type: str) -> str:
    """Tạo Model/Dataset Card README.md chuẩn chỉ trên Hugging Face"""
    tag_list = "\n".join([f"- {t}" for t in cfg["tags"]])
    label_table = "\n".join([f"| `{k}` | **{v}** |" for k, v in cfg["labels"].items()])
    stats = cfg["stats"]

    if dataset_type == "emotion":
        upstream_tag_yaml = """- uitnlp/vsmec
- google-research-datasets/go_emotions"""
        custom_desc = """
Tập dữ liệu nhận diện cảm xúc tiếng Việt (7 lớp) phục vụ các hệ thống phân tích sắc thái mạng xã hội và sức khỏe tinh thần.
Dữ liệu được hợp nhất (merge) và làm sạch từ hai nguồn chính:
1. **UIT-VSMEC**: Ngữ liệu cảm xúc mạng xã hội tiếng Việt chuẩn từ Đại học Công nghệ Thông tin (ĐHQG-HCM).
2. **GoEmotions (Google Research)**: Tập dữ liệu cảm xúc 58k bình luận Reddit của Google Research, được trích xuất các nhóm cảm xúc thiểu số (Fear, Surprise, Disgust, Anger, Joy, Sadness) và dịch ngữ nghĩa sang tiếng Việt tự nhiên để tái cân bằng phân bố ngữ liệu.

### Taxonomy (7 Nhãn Cảm Xúc):
| Label ID | Tên Nhãn | Ý Nghĩa / Ngữ Cảnh |
| :---: | :--- | :--- |
| `0` | **Enjoyment** | Vui vẻ, hào hứng, tự hào, hài lòng, hạnh phúc |
| `1` | **Sadness** | Buồn bã, đau lòng, thất vọng, cô đơn |
| `2` | **Disgust** | Kinh tởm, khó chịu, ghê sợ, bài xích |
| `3` | **Anger** | Giận dữ, bực tức, phẫn nộ, ức chế |
| `4` | **Fear** | Sợ hãi, bất an, lo lắng, hoảng loạn |
| `5` | **Surprise** | Bất ngờ, ngạc nhiên, sửng sốt |
| `6` | **Other** | Trung tính, câu hỏi, phát biểu chung không rõ cảm xúc |
"""
        citations_block = """## 4. Nguồn Dữ Liệu Gốc & Trích Dẫn (Upstream Sources & Citations)

Tập dữ liệu này được xây dựng và kế thừa từ các công trình nghiên cứu mở sau đây. Chúng tôi xin chân thành cảm ơn các tác giả:

1. **UIT-VSMEC (Vietnamese Social Media Emotion Corpus)**:
```bibtex
@inproceedings{ho2020vsmec,
  title     = {Emotion Recognition for Vietnamese Social Media Text},
  author    = {Vong Anh Ho and Duong Huynh-Cong Nguyen and Danh Hoang Nguyen and Pham-Nguyen Cuong and Duc-Vu Nguyen and Kiet Van Nguyen and Ngan Luu-Thuy Nguyen},
  booktitle = {2020 17th International Conference on Electrical Engineering/Electronics, Computer, Telecommunications and Information Technology (ECTI-CON)},
  year      = {2020}
}
```

2. **GoEmotions (Google Research)**:
```bibtex
@inproceedings{demszky2020goemotions,
  title     = {{GoEmotions: A Dataset of Fine-Grained Emotions}},
  author    = {Dorottya Demszky and Dana Movshovitz-Attias and Jeongwoo Ko and Alan Cowen and Gaurav Nemade and Sujith Ravi},
  booktitle = {58th Annual Meeting of the Association for Computational Linguistics (ACL)},
  year      = {2020}
}
```
"""
    else:
        upstream_tag_yaml = """- uitnlp/vihsd
- ourafla/Mental-Health_Text-Classification_Dataset"""
        custom_desc = """
Tập dữ liệu kiểm duyệt nội dung (Content Moderation & Safety) mạng xã hội tiếng Việt gồm 4 lớp phân loại nguy cơ.
Dữ liệu phiên bản v1.1 được xây dựng bằng cách hợp nhất (merge) các nguồn nghiên cứu mở uy tín:
1. **ViHSD (UIT-ViHSD)**: Tập dữ liệu phát hiện ngôn từ thù ghét trên mạng xã hội tiếng Việt từ Đại học Công nghệ Thông tin (ĐHQG-HCM) cung cấp các nhãn Clean, Profanity/Offensive, Hate Speech.
2. **Mental Health / Suicide Ideation Dataset**: Bộ dữ liệu khủng hoảng tâm lý/tự hại từ Reddit r/SuicideWatch & r/depression được dịch và bản địa hóa an toàn sang tiếng Việt để xây dựng lớp `SELF_HARM_CRISIS`.
3. **Kỹ thuật Cân Bằng (v1.1)**: Đã thực hiện Undersampling lớp CLEAN (về ~8,000 mẫu) nhằm triệt tiêu thiên kiến đa số và tối ưu Macro F1 cho các nhãn nhạy cảm.

### Taxonomy (4 Lớp Kiểm Duyệt):
| Label ID | Tên Nhãn | Ý Nghĩa / Nguy Cơ |
| :---: | :--- | :--- |
| `0` | **CLEAN** | Nội dung an toàn, thảo luận bình thường |
| `1` | **PROFANITY_VENTING** | Từ ngữ tục tĩu nhưng mang tính xả stress/than vãn cá nhân, không công kích ai |
| `2` | **HATE_SPEECH** | Ngôn từ thù ghét, xúc phạm danh dự, phân biệt vùng miền/giới tính/tôn giáo |
| `3` | **SELF_HARM_CRISIS** | Nội dung có dấu hiệu khủng hoảng tâm lý, tự hại, tiêu cực nghiêm trọng |
"""
        citations_block = """## 4. Nguồn Dữ Liệu Gốc & Trích Dẫn (Upstream Sources & Citations)

Tập dữ liệu này được xây dựng và kế thừa từ các công trình nghiên cứu mở sau đây. Chúng tôi xin chân thành cảm ơn các tác giả:

1. **UIT-ViHSD (Vietnamese Hate Speech Detection)**:
```bibtex
@article{luu2021vihsd,
  title   = {Constructing a Vietnamese Dataset for Advanced Hate Speech Detection on Social Media},
  author  = {Son T. Luu and Kiet Van Nguyen and Ngan Luu-Thuy Nguyen},
  journal = {ACM Transactions on Asian and Low-Resource Language Information Processing},
  year    = {2021}
}
```

2. **Mental Health Text Classification**:
```bibtex
@misc{ourafla2023mentalhealth,
  title        = {Mental Health Text Classification Dataset},
  author       = {Ourafla},
  year         = {2023},
  howpublished = {\\url{https://huggingface.co/datasets/ourafla/Mental-Health_Text-Classification_Dataset}}
}
```
"""

    return f"""---
language:
- vi
license: mit
task_categories:
- text-classification
tags:
{tag_list}
source_datasets:
{upstream_tag_yaml}
size_categories:
- 10K<n<100K
---

# {dataset_type.capitalize()} Dataset for Vietnamese Social Media ({dataset_type.upper()} v1.1)

{cfg['description']}

## 1. Tổng Quan & Phân Bố (Dataset Summary)

* **Tổng số mẫu:** {stats['total']:,} mẫu
* **Tập Train (70%):** {stats['train']:,} mẫu
* **Tập Val (15%):** {stats['val']:,} mẫu
* **Tập Test (15%):** {stats['test']:,} mẫu

{custom_desc}

## 2. Cấu Trúc Bản Ghi (Schema Format)

Mỗi mẫu dữ liệu được lưu dưới dạng JSON object với các trường:
```json
{{
  "text": "văn bản đã được chuẩn hóa hoặc tách từ",
  "raw_text": "văn bản gốc tiếng Việt",
  "label": 0,
  "label_name": "{list(cfg['labels'].values())[0]}",
  "source": "tên nguồn dữ liệu"
}}
```

## 3. Cách Tải & Sử Dụng với `datasets` (Hugging Face)

```python
from datasets import load_dataset

# Tải dataset trực tiếp
dataset = load_dataset("{cfg['default_repo_id']}")

print(dataset["train"][0])
```

Hoặc đọc trực tiếp từ Pandas:
```python
import pandas as pd

df_train = pd.read_json("train.json")
df_test = pd.read_json("test.json")
print("Train samples:", len(df_train))
```

{citations_block}
"""


def upload_single_dataset(dataset_type: str, repo_id: str, token: str):
    cfg = DATASET_CONFIGS[dataset_type]
    api = HfApi(token=token)

    print(f"\n=======================================================")
    print(f"📦 BẮT ĐẦU UPLOAD DATASET: [{dataset_type.upper()}] -> {repo_id}")
    print(f"=======================================================")

    # 1. Tạo repo dataset trên HF Hub nếu chưa có
    print(f"[1/3] Tạo / Kiểm tra dataset repo: {repo_id}...")
    create_repo(repo_id=repo_id, token=token, repo_type="dataset", exist_ok=True)
    print(f"      ✓ Repo dataset sẵn sàng.")

    # 2. Tạo Dataset Card README.md tạm thời và upload
    readme_content = generate_dataset_card(cfg, dataset_type)
    temp_readme = EVAL_DIR / f"temp_README_{dataset_type}.md"
    with open(temp_readme, "w", encoding="utf-8") as f:
        f.write(readme_content)

    print(f"[2/3] Upload README.md (Dataset Card)...")
    api.upload_file(
        path_or_fileobj=str(temp_readme),
        path_in_repo="README.md",
        repo_id=repo_id,
        repo_type="dataset",
        commit_message=f"Update Dataset Card README.md for {dataset_type}",
    )
    if temp_readme.exists():
        temp_readme.unlink()

    # 3. Upload từng file dữ liệu (train, val, test, merged)
    print(f"[3/3] Upload các tệp dữ liệu...")
    for src_file in cfg["source_files"]:
        if not src_file.exists():
            print(f"      ❌ CẢNH BÁO: Không tìm thấy file {src_file}")
            continue

        target_name = cfg["target_file_mapping"].get(src_file.name, src_file.name)
        file_size_mb = src_file.stat().st_size / (1024 * 1024)
        print(f"      Uploading: {src_file.name} -> {target_name} ({file_size_mb:.2f} MB)...")

        api.upload_file(
            path_or_fileobj=str(src_file),
            path_in_repo=target_name,
            repo_id=repo_id,
            repo_type="dataset",
            commit_message=f"Add {target_name} ({dataset_type} v1.1)",
        )

    print(f"\n🎉 UPLOAD THÀNH CÔNG [{dataset_type.upper()}] DATASET!")
    print(f"🔗 URL: https://huggingface.co/datasets/{repo_id}")


def main():
    parser = argparse.ArgumentParser(description="Upload Datasets to Hugging Face")
    parser.add_argument("--type", choices=["emotion", "moderation", "all"], default="all", help="Dataset type to upload")
    parser.add_argument("--emotion-repo", type=str, default=DATASET_CONFIGS["emotion"]["default_repo_id"])
    parser.add_argument("--moderation-repo", type=str, default=DATASET_CONFIGS["moderation"]["default_repo_id"])
    parser.add_argument("--token", type=str, default=None, help="Hugging Face Write Token")

    args = parser.parse_args()

    hf_token = args.token or os.getenv("HF_TOKEN")
    if not hf_token:
        print("⚠️ Không tìm thấy biến môi trường HF_TOKEN.")
        hf_token = input("👉 Nhập Hugging Face Write Token: ").strip()

    if not hf_token:
        print("❌ Lỗi: HF Token không được để trống!")
        sys.exit(1)

    if args.type in ["emotion", "all"]:
        upload_single_dataset("emotion", args.emotion_repo, hf_token)

    if args.type in ["moderation", "all"]:
        upload_single_dataset("moderation", args.moderation_repo, hf_token)

    print("\n" + "=" * 65)
    print("✨ TẤT CẢ DATASETS ĐÃ ĐƯỢC UPLOAD LÊN HUGGING FACE THÀNH CÔNG!")
    print("=" * 65)


if __name__ == "__main__":
    main()
