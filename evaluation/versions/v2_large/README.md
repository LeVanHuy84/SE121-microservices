# PHIÊN BẢN V2.0 (EXPERIMENTAL PHOBERT-LARGE)

Thư mục này chứa toàn bộ thử nghiệm fine-tune trên kiến trúc mô hình kích thước lớn PhoBERT-Large (370M Parameters) phiên bản V2.0.

---

## 1. Danh sách thành phần:
- `finetune_phobert_emotion_large_v2.ipynb`: Notebook thử nghiệm PhoBERT-Large V2 (12 Epochs Cosine Scheduler).
- `FINETUNING_HYPERPARAMETERS_GUIDE_V2.md`: Hướng dẫn siêu tham số chi tiết cho bản PhoBERT-Large.
- `logs/`: Thư mục lưu trữ nhật ký thực nghiệm:
  - `test_log.txt`: Báo cáo đánh giá độc lập `classification_report` (Accuracy: 62.69%, Macro F1: 62.15%).
  - `training_performance_curves.png`: Đồ thị trực quan hóa đường cong Validation Loss và Validation F1.

---

## 2. Kết quả đánh giá V2.0 (Large):
- **Model Architecture**: `vinai/phobert-large` (370M parameters - gấp 2.7 lần bản Base)
- **Held-Out Test Accuracy**: `62.69%`
- **Held-Out Test Macro F1**: `62.15%`
- **Latency / Request**: **~62 ms** (Chậm hơn 3.4 lần so với bản V1.1)

> **Kết luận thực nghiệm**: PhoBERT-Large tuy có dung lượng 370M tham số nhưng dễ gặp hiện tượng Overfitting nhẹ trên tập dữ liệu ~10k mẫu, dẫn đến Macro F1 thấp hơn bản Base V1.1 (62.15% so with 63.56%). Do đó nhóm đã quyết định chọn **V1.1 Base** làm bản sản xuất chính thức.
