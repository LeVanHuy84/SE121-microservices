# Evaluation & Machine Learning Modules

## Overview
Comprehensive machine learning evaluation frameworks, training datasets, preprocessing pipelines, model benchmarks, and ONNX export routines powering the AI and recommendation capabilities of the SE121 microservices platform.

## Subdirectories & Boundaries
- [emotion](./emotion/README.md) - PhoBERT emotion recognition models (7-class sentiment classification), training logs, benchmark reports, and ONNX conversion pipelines.
- [moderation](./moderation/pipeline/README.md) - Vietnamese toxicity and mental health crisis detection models (PhoBERT Moderation - 4 classes) with data augmentation pipelines.
- [music](./music/README.md) - Emotion-aligned music feature extraction using MERT audio embeddings.
- [image-experiment](./image-experiment/README.md) - Vision-Language multimodal sentiment analysis experiments, human review UI, and benchmark datasets.

---

## 📂 Cấu Trúc Tổng Thể

```
evaluation/
├── emotion/               # 🎭 Phân tích cảm xúc văn bản (PhoBERT Emotion - 7 classes)
│   ├── data/              # Datasets VSMEC & GoEmotions augmented
│   ├── pipeline/          # Scripts nạp dữ liệu, làm sạch, teencode, xuất ONNX, upload Hugging Face
│   ├── versions/          # Notebooks & Logs huấn luyện (v1.0, v1.1_final, v2_large)
│   ├── results/           # Báo cáo benchmark đối chứng, độ trễ, stress test
│   └── collection-data/   # Ngữ liệu bình luận thực tế (Facebook, Threads, VnExpress)
│
├── moderation/            # 🛡️ Kiểm duyệt nội dung & cảnh báo khủng hoảng tâm lý (PhoBERT Moderation - 4 classes)
│   ├── data/              # Tập dữ liệu ViHSD & Self-harm augmented (v1.0, v1.1)
│   ├── pipeline/          # Pipeline tiền xử lý & dịch thuật tăng cường
│   ├── versions/          # Sổ tay huấn luyện PhoBERT Moderation (v1.0, v1.1)
│   └── results/           # Kết quả đánh giá mô hình
│
├── music/                 # 🎵 Khuyến nghị âm nhạc theo cảm xúc (MERT Audio Feature Extraction)
│   ├── data/              # Metadata & audio splits
│   ├── notebooks/         # Sổ tay trích xuất đặc trưng & fine-tune
│   ├── scripts/           # Script tiền xử lý và inference
│   └── results/           # Kết quả kiểm thử
│
├── image-experiment/      # 🖼️ Thử nghiệm phân tích cảm xúc đa phương tiện (VLM Vision-Language)
│   ├── README.md
│   ├── review_server.py
│   ├── human_review_ui.html
│   └── data/              # 600 VLM benchmark samples, images & annotations
│
└── weights/               # ⚖️ Thư mục lưu trữ model checkpoints & ONNX weights dùng chung cho microservices
```
