# PHIÊN BẢN V1.0 (BASELINE PHOBERT-BASE)

Thư mục này chứa toàn bộ hồ sơ, mã nguồn notebook, tài liệu hướng dẫn và nhật ký thực nghiệm (`logs/`) cho Phiên bản V1.0 (Baseline) sử dụng phương pháp Stratified 5-Fold Cross-Validation trên kiến trúc `vinai/phobert-base-v2`.

---

## 1. Danh sách thành phần:
- `finetune_phobert_emotion.ipynb`: Notebook huấn luyện Stratified 5-Fold Cross-Validation phiên bản v1.0.
- `FINETUNING_HYPERPARAMETERS_GUIDE.md`: Hướng dẫn thiết lập siêu tham số chuẩn cho v1.0.
- `logs/`: Thư mục lưu trữ nhật ký thực nghiệm (`finetune_log.txt`, `test_log.txt`, `training_performance_curves.png`).

---

## 2. Kết quả đánh giá v1.0 (Baseline):
- **Model Architecture**: `vinai/phobert-base-v2` (135M parameters)
- **Training Strategy**: Stratified 5-Fold Cross-Validation (Epochs: 4, LR: 2e-5, Batch Size: 16)
- **Held-Out Test Accuracy**: `63.75%`
- **Held-Out Test Macro F1**: `63.15%`
