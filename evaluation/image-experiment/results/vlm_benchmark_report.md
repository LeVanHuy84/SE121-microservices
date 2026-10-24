# Báo Cáo Thực Nghiệm Đánh Giá Mô Hình VLM (gemini-3.5-flash-lite)

**Đề tài:** Nhận diện và Phân tích Cảm xúc Đa phương thức trên Mạng Xã Hội (KLTN SE121)  
**Thời gian thực hiện:** 24/10/2026 08:30:23  
**Mô hình VLM:** `gemini-3.5-flash-lite`  
**Tập kiểm thử:** Chuẩn Vàng Đơn Nhãn Benchmark (SE121 Gold Test Set)  
**Quy mô mẫu đánh giá:** **678** mẫu sạch (đã loại bỏ các mẫu gắn cờ lỗi ngữ cảnh).  

---

## 1. Bảng Tổng Hợp Chỉ Số Hiệu Năng Cốt Lõi

| Chỉ số Đánh Giá | Kết quả Thực Nghiệm | Đánh giá Chuẩn Học Thuật |
| :--- | :---: | :--- |
| **Accuracy (Độ chính xác toàn thể)** | **81.56%** | Tỷ lệ dự đoán đúng nhãn cảm xúc chính xác 1-1 với Chuẩn vàng |
| **Macro-F1 Score** | **0.6621** | Trung bình không trọng số (phản ánh công bằng cả các lớp hiếm) |
| **Weighted-F1 Score** | **0.8171** | Trung bình có trọng số theo phân phối mẫu thực tế |
| **Độ trễ trung bình (Latency)** | **3.09s** / bài | Thời gian xử lý nén ảnh + gọi API VLM |
| **Độ chính xác phát hiện Mỉa mai (Sarcasm)** | **84.96%** | Nhận diện xung đột đối lập giữa hình ảnh và ngữ nghĩa văn bản |

---

## 2. Bóc Tách Chi Tiết Theo Từng Lớp Cảm Xúc (Per-Class Breakdown)

> [!NOTE]
> Bảng bóc tách phân tích sâu theo yêu cầu của GVHD để đánh giá khả năng nhận diện các cảm xúc tiêu cực và các cặp cảm xúc dễ lẫn lộn trên mạng xã hội.

| Nhãn Cảm Xúc | Precision | Recall | F1-Score | Số lượng mẫu (Support) | Đánh giá năng lực mô hình |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`joy`** | 0.8989 | 0.9135 | **0.9062** | 370 | Rất tốt (≥ 0.80) |
| **`sadness`** | 0.8125 | 0.4643 | **0.5909** | 28 | Cần theo dõi (< 0.70) |
| **`anger`** | 0.8618 | 0.7465 | **0.8000** | 142 | Rất tốt (≥ 0.80) |
| **`fear`** | 0.7000 | 0.4375 | **0.5385** | 16 | Cần theo dõi (< 0.70) |
| **`disgust`** | 0.4219 | 0.6279 | **0.5047** | 43 | Cần theo dõi (< 0.70) |
| **`surprise`** | 0.5000 | 0.5455 | **0.5217** | 11 | Cần theo dõi (< 0.70) |
| **`neutral`** | 0.7273 | 0.8235 | **0.7724** | 68 | Khá tốt (≥ 0.70) |

---

## 3. Ma Trận Nhầm Lẫn (Confusion Matrix 7x7)

Hàng ngang là **Nhãn Chuẩn Vàng (Ground Truth)**, Cột dọc là **Nhãn Dự Đoán của VLM (Predicted)**:

| Ground Truth \ Predict | `joy` | `sadness` | `anger` | `fear` | `disgust` | `surprise` | `neutral` | **Tổng GT (Support)** | **Recall (%)** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`joy`** | **338** | 1 | 4 | 1 | 11 | 4 | 11 | **370** | **91.4%** |
| **`sadness`** | 10 | **13** | 2 | - | - | - | 3 | **28** | **46.4%** |
| **`anger`** | 8 | 1 | **106** | - | 23 | 1 | 3 | **142** | **74.6%** |
| **`fear`** | 3 | 1 | 2 | **7** | 1 | - | 2 | **16** | **43.8%** |
| **`disgust`** | 8 | - | 6 | 1 | **27** | 1 | - | **43** | **62.8%** |
| **`surprise`** | 2 | - | - | - | 1 | **6** | 2 | **11** | **54.5%** |
| **`neutral`** | 7 | - | 3 | 1 | 1 | - | **56** | **68** | **82.4%** |
| **Tổng Pred** | **376** | **16** | **123** | **10** | **64** | **12** | **77** | **678** | **Acc: 81.6%** |

---

## 4. Phân Tích Nhận Diện Mỉa Mai & Xung Đột Ảnh-Chữ (Sarcasm Analysis)

- **Tổng số mẫu có yếu tố mỉa mai (`INCONGRUENT`):** 74 mẫu.
- **VLM phát hiện chính xác (`is_sarcasm_or_conflict = True`):** 36 mẫu (48.6%).
- **Mẫu bình thường (ảnh minh họa/bổ trợ) không bị báo động giả:** 540 / 604 mẫu (89.4%).

---

*Báo cáo được sinh tự động bởi pipeline kiểm thử thực nghiệm `evaluation/image-experiment/run_vlm_benchmark.py`.*
