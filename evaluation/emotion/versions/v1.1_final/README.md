# PHIÊN BẢN V1.1 (PRODUCTION FINAL - CHÍNH THỨC SỬ DỤNG)

Thư mục này chứa toàn bộ bộ mã nguồn, tài liệu hướng dẫn, siêu tham số và nhật ký thực nghiệm (`logs/`) của Phiên bản V1.1 (Optimized Production). Đây là phiên bản được lựa chọn chính thức để đóng gói và tích hợp vào dịch vụ AI backend (`analysis-service`).

---

## 1. Danh sách thành phần:
- `finetune_phobert_emotion_v1.1.ipynb`: Notebook huấn luyện chính thức V1.1 (Tích hợp Inverse Class-Weighted CrossEntropy Loss & Cosine Decay Scheduler).
- `FINETUNING_HYPERPARAMETERS_GUIDE_V1.1.md`: Tài liệu phương pháp luận & cơ sở khoa học chi tiết cho V1.1.
- `logs/`: Thư mục lưu trữ nhật ký thực nghiệm:
  - `test_log.txt`: Báo cáo đánh giá độc lập `classification_report` (Accuracy: 63.77%, Macro F1: 63.56%).
  - `training_performance_curves.png`: Đồ thị trực quan hóa đường cong Validation Loss và Validation F1.

---

## 2. Kết quả đánh giá V1.1 (Được chọn làm sản phẩm chính):
- **Model Architecture**: `vinai/phobert-base-v2` (135M parameters)
- **Loss Function**: Custom Inverse Class-Weighted CrossEntropy Loss (Cứu nhãn khó `Disgust` & `Other`)
- **LR Scheduler**: Cosine Annealing Decay (Warmup Steps: 300)
- **Held-Out Test Accuracy**: `63.77%`
- **Held-Out Test Macro F1**: **63.56%** (Vượt Pre-trained Baseline `visolex` +5.11% Macro F1)
- **Latency / Request**: **~18 ms** (Tối ưu hóa tối đa cho thời gian thực)
