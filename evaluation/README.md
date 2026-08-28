# BÁO CÁO & THƯ MỤC HUẤN LUYỆN DỰ ÁN DỰ ĐOÁN CẢM XÚC (EVALUATION MODULE)

Thư mục này chứa toàn bộ quy trình NCKH, tập dữ liệu, pipeline tiền xử lý và các phiên bản mô hình Fine-Tuning phục vụ phân tích cảm xúc tiếng Việt.

---

## 1. Cấu Trúc Các Phiên Bản Mô Hình (`evaluation/versions/`)

Toàn bộ các phiên bản huấn luyện, notebook, hướng dẫn siêu tham số và nhật ký log kết quả (`logs/`) được đóng gói độc lập theo từng phiên bản trong thư mục `evaluation/versions/`:

* **`versions/v1.1_final/`**: PHIÊN BẢN SẢN XUẤT CHÍNH THỨC (PRODUCTION). Dùng `phobert-base-v2` (135M), Inverse Class-Weighted Loss, đạt Held-Out Test Acc = 63.77% & Macro F1 = 63.56%.
* **`versions/v1.0/`**: Phiên bản Baseline ban đầu trên tập VSMEC thuần (Stratified 5-Fold Cross-Validation).
* **`versions/v2_large/`**: Thử nghiệm với PhoBERT-Large (370M parameters).

---

## 2. Bảng So Sánh Số Liệu Thực Nghiệm Tổng Quan (Cross-Version Benchmark Table)

Bảng so sánh đối chiếu số liệu kiểm thử độc lập giữa mô hình Pre-trained Baseline trên HuggingFace (`visolex/phobert-emotion`) và các phiên bản tự fine-tune của dự án:

| Mô Hình / Thư Mục Phiên Bản | Model Architecture | Hyperparameters | Held-Out Test Acc | Held-Out Test F1 | Latency / Request | Trạng Thái Lựa Chọn / Ghi Chú |
| :--- | :--- | :--- | :---: | :---: | :---: | :--- |
| Baseline (`visolex/phobert-emotion`) | `phobert-base-v2` | Pre-trained HuggingFace | 61.18% | 58.45% | 18 ms | Baseline đối chứng (Bị tệt ngòi nhãn Anger 44.44%) |
| `versions/v1.0/` | `phobert-base-v2` | LR=2e-5, Epoch=4, 5-Fold | 63.75% | 63.15% | 18 ms | Fine-tune v1.0 trên VSMEC gốc |
| `versions/v2_large/` | `phobert-large` | LR=1.5e-5, Epoch=12 | 62.69% | 62.15% | 62 ms | Thử nghiệm Large 370M (Overfitting nhẹ) |
| **`versions/v1.1_final/`** | `phobert-base-v2` | LR=2e-5, Class-Weighted | **63.77%** | **63.56%** | **18 ms** | **CHÍNH THỨC (Production Selected - Vượt Baseline +5.11% F1)** |

---

## 3. Chi Tiết So Sánh F1-Score Theo 7 Lớp Cảm Xúc (Detailed Per-Class F1 Comparison)

Bảng chi tiết F1-Score từng nhãn cảm xúc trên Held-Out Test Set của mô hình Pre-trained Baseline (`visolex`) và 3 phiên bản Fine-Tuned:

| Mã | Tên Nhãn Cảm Xúc | Baseline (`visolex`) | v1.0 (5-Fold Base) | v2_large (Large 370M) | v1.1_final (Production) | Cải Thiện V1.1 vs Baseline (Delta F1) |
| :-: | :--- | :-: | :-: | :-: | :-: | :---: |
| **0** | **Enjoyment** (Vui vẻ) | 70.47% | 76.13% | **76.27%** | **74.59%** | +4.12% |
| **1** | **Sadness** (Buồn rầu) | 69.41% | 64.20% | **66.52%** | **63.07%** | -6.34% |
| **2** | **Disgust** (Khinh bỉ) | 55.41% | **55.90%** | 50.60% | **55.40%** | -0.01% |
| **3** | **Anger** (Tức giận) | 44.44% | 67.21% | 64.16% | **72.15%** | **+27.71%** *(Bứt phá kỷ lục)* |
| **4** | **Fear** (Sợ hãi) | 65.38% | **68.26%** | 63.88% | **63.74%** | -1.64% |
| **5** | **Surprise** (Ngạc nhiên) | 53.57% | 59.26% | 61.75% | **61.54%** | +7.97% |
| **6** | **Other** (Khác / Mơ hồ) | 50.46% | 51.12% | 51.85% | **54.42%** | **+3.96%** *(Nhờ Inverse Class-Weight)* |
| **---** | **MACRO F1 SCORE** | **58.45%** | **63.15%** | **62.15%** | **63.56%** | **+5.11%** |

---

## 4. Các Báo Cáo Phân Tích Chuyên Sâu
- [DATASET_AND_FINETUNING_REPORT.md](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/DATASET_AND_FINETUNING_REPORT.md): Phân tích tập dữ liệu lai 9,877 mẫu.
- [baseline_vs_finetuned_benchmark_report.md](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/results/report/baseline_vs_finetuned_benchmark_report.md): Báo cáo so sánh đối chứng chi tiết từng nhãn cảm xúc giữa Baseline (`visolex`) và V1.1.
