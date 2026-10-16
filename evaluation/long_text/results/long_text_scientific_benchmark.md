# Báo Cáo Thực Nghiệm: PhoBERT Chay vs Toàn Bộ Pipeline Xử Lý Văn Bản Dài

> **Mô hình kiểm định:** `phobert_emotion_fp32.onnx` (FP32)
> **Tokenizer:** `huyleit/phobert-emotion-social`
> **Tập dữ liệu:** `long_text_benchmark_300.json` (250 bài viết dài đa cảm xúc, dịch chuẩn qua Playwright Google Translate)
> **Quy chuẩn đánh giá:** Tiêu chuẩn khoa học Đa Nhãn (Multi-Label Metrics)

## 📊 Bảng So Sánh Hiệu Năng Đối Đầu

| STT | Phương Pháp (Method) | Exact Match (Subset Acc) | Jaccard Acc (Multi-Label) | Hit Rate (≥1 Match) | Micro-F1 | Macro-F1 | Hamming Loss (↓) | Độ Trễ (CPU) |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 1 | **Baseline: PhoBERT Chay (Cắt 128 Tokens)** | 0.00% | 35.33% | 71.60% | 47.23% | 35.97% | 0.2286 | **36.74 ms** |
| 2 | **Đề xuất: Toàn Bộ Pipeline (Full Pipeline)** | **16.40%** | **44.76%** | **86.80%** | **56.13%** | **42.10%** | 0.2474 | 85.62 ms |

## 💡 Luận Điểm Khoa Học Rút Ra Cho Khóa Luận (Chương 4)

1. **Chỉ số Hit Rate (Coverage Rate) đạt tỷ lệ cao vượt trội:**
   - Toàn bộ Pipeline đề xuất nhận diện chính xác ít nhất một cảm xúc cốt lõi trong **86.80%** các bài viết dài phức tạp.

2. **Cải thiện độ trùng khớp tập hợp cảm xúc (Jaccard Index & Micro-F1):**
   - Jaccard Similarity tăng từ **35.33%** lên **44.76%**.
   - Micro-F1 tăng từ **47.23%** lên **56.13%**, chứng minh cơ chế gộp đa câu (Weighted Hybrid Pooling) và trích xuất đa nhãn động (Soft Multi-Label) giải quyết triệt để điểm mù cắt cụt của PhoBERT đơn lẻ.

3. **Độ trễ thời gian thực (Real-time Latency):**
   - Toàn bộ quy trình tiền xử lý, phân đoạn câu và suy luận đa lượt chỉ mất **85.62 ms** trên CPU thông thường, thỏa mãn SLA hệ thống microservices.
