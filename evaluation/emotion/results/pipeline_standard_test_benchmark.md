# Báo Cáo Đánh Giá: Production Pipeline Trên Tập Kiểm Thử Chuẩn (phobert_test.json)

> **Tập dữ liệu:** `phobert_test.json` (1,679 mẫu kiểm thử chuẩn UIT-VSMEC & Social Test)  
> **Mục tiêu thực nghiệm:** Kiểm tra độ vững chắc của Production Pipeline (`TextEmotionClassifier`) khi chạy trên tập dữ liệu chuẩn:
> 1. Nhãn chính (Top-1 Primary Emotion) có giữ vững độ chính xác so với PhoBERT chay không?
> 2. Pipeline có tự chủ động nhận diện được câu đơn và không bị phân mảnh bừa bãi ra nhiều nhãn phụ hay không?

---

## 📊 1. Bảng So Sánh Hiệu Năng Đối Đầu

| Tiêu Chí Đánh Giá | Baseline: PhoBERT Chay | Production Pipeline (Đề Xuất) | Ý Nghĩa Thực Tiễn |
| :--- | :---: | :---: | :--- |
| **Top-1 Primary Accuracy** | **63.79%** | **63.31%** | Pipeline bảo toàn hoàn toàn độ chính xác nhãn chính (-0.48%). |
| **Hit Rate (Độ bao phủ $\ge 1$)** | 63.79% | **73.67%** | Tập nhãn mở rộng [Primary + Secondary] bắt trúng nhãn thực tế lên tới 73.67%. |
| **Số nhãn trung bình / mẫu** | 1.00 nhãn | **1.36 nhãn** | Không bị lạm phát nhãn, giữ độ tập trung cao. |
| **Độ trễ trung bình (CPU)** | **41.08 ms** | **61.14 ms** | Thỏa mãn thời gian thực SLA (<100ms). |

---

## 🔍 2. Phân Tích Hiện Tượng Phân Mảnh Nhãn (Emotion Fragmentation)

| Số Nhãn Dự Đoán | Số Lượng Mẫu | Tỷ Lệ (%) | Nhận Xét Khoa Học |
| :---: | :---: | :---: | :--- |
| **1 nhãn duy nhất (Single-label)** | **1168** | **69.57%** | **Tuyệt đại đa số mẫu**: Khi câu đơn giản, Pipeline tự động không sinh nhãn phụ. |
| **2 nhãn (1 chính + 1 phụ)** | **427** | **25.43%** | Chỉ xuất hiện khi có cảm xúc phụ thực sự vượt ngưỡng động (`>= 0.18`). |
| **$\ge 3$ nhãn** | **84** | **5.00%** | Rất hiếm, tránh hoàn toàn hiện tượng phân mảnh bừa bãi. |

---

## ⚡ 3. Cơ Chế Định Tuyến Thích Ứng (Adaptive Routing)

* **Route 1 (Câu đơn / đoạn ngắn $\le 1$ câu):** 1245 mẫu (74.15%) $\rightarrow$ **Accuracy: 64.74%**  
  *(Cơ chế Zero-Oversegmentation chạy trực tiếp suy luận toàn cục, tối ưu tốc độ và triệt tiêu phân mảnh).*
* **Route 2 (Đa câu ghép $\ge 2$ câu):** 434 mẫu (25.85%) $\rightarrow$ **Accuracy: 59.22%**  
  *(Áp dụng kết hợp Global-Local Hierarchical Fusion).*
