# Evaluation & Machine Learning Modules

Thư mục `evaluation/` chứa toàn bộ quy trình nghiên cứu khoa học, tập dữ liệu huấn luyện, pipeline tiền xử lý, sổ tay notebook và thực nghiệm benchmark của các mô hình AI/ML trong hệ thống SE121-microservices.

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
│   └── vlm_groq_pipeline.py
│
└── weights/               # ⚖️ Thư mục lưu trữ model checkpoints & ONNX weights dùng chung cho microservices
```

---

## 🚀 Hướng Dẫn Nhanh Cho Từng Phân Hệ

* **PhoBERT Emotion Recognition**: Xem tài liệu chi tiết tại [`evaluation/emotion/README.md`](./emotion/README.md).
* **PhoBERT Moderation**: Xem tài liệu chi tiết tại [`evaluation/moderation/pipeline/README.md`](./moderation/pipeline/README.md).
* **Music Emotion Recommendation**: Xem tài liệu chi tiết tại [`evaluation/music/README.md`](./music/README.md).
* **Image Emotion Experiment**: Xem tài liệu chi tiết tại [`evaluation/image-experiment/README.md`](./image-experiment/README.md).
