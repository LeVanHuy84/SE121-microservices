# HƯỚNG DẪN CHI TIẾT & PHƯƠNG PHÁP LUẬN FINETUNING PHOBERT-LARGE EMOTION (VERSION 2)

Tài liệu này trình bày phương pháp luận khoa học, cơ sở lý thuyết, giải thích các siêu tham số (Hyperparameters), kiến trúc **Weighted Loss Trainer** và hướng dẫn thực thi notebook `finetune_phobert_emotion_v2.ipynb` trên **Google Colab (T4 GPU)**.

---

## 1. PHƯƠNG PHÁP LUẬN KHOA HỌC & KIẾN TRÚC MÔ HÌNH PHOBERT-LARGE

### 1.1 Mô hình Nền tảng PhoBERT-Large (`vinai/phobert-large`)
* **Kiến trúc**: Dựa trên kiến trúc **RoBERTa Large** (Liu et al., 2019) với **370 triệu tham số (370M Parameters)**, gấp 2.7 lần bản PhoBERT-Base. Mô hình được pre-trained trên **20GB ngữ liệu tiếng Việt chuẩn** (Nguyen & Nguyen, EMNLP 2020).
* **Ưu điểm**: Khả năng nắm bắt ngữ cảnh cú pháp phức tạp, biểu cảm mỉa mai (sarcasm) và sắc thái ngôn ngữ mạng xã hội Tiếng Việt vượt trội hơn hẳn so với bản Base.

### 1.2 Kiến trúc Class-Weighted CrossEntropy Loss Trainer
Do nhãn `Other` (Khác/Mơ hồ) và `Disgust` (Khinh bỉ) có F1-score thấp hơn các nhãn khác, notebook V2 tích hợp custom class-weights vào hàm Loss CrossEntropy:
$$\mathcal{L} = -\sum_{i=1}^{N} w_i \cdot y_i \log(\hat{y}_i)$$
Trong đó trọng số phạt được thiết lập nghịch đảo theo độ khó của từng nhãn: `class_weights = [Enjoyment: 1.0, Sadness: 1.1, Disgust: 1.5, Anger: 1.1, Fear: 1.2, Surprise: 1.4, Other: 1.7]`.

---

## 2. CHI TIẾT BẢNG SIÊU THAM SỐ (HYPERPARAMETERS) & LÝ DO CHỌN

| Siêu Tham Số (Hyperparameter) | Giá Trị Thiết Lập | Cơ Sở Khoa Học & Lý Do Lựa Chọn |
| :--- | :---: | :--- |
| **Base Model** | `vinai/phobert-large` | Mô hình ngôn ngữ RoBERTa Tiếng Việt mạnh nhất hiện nay với 370M tham số. |
| **Max Length** | `128` | Bảo toàn 100% ngữ cảnh câu văn mạng xã hội mà không gây lãng phí VRAM GPU. |
| **Max Train Epochs** | `8` | Đặt trần 8 Epochs kết hợp với Early Stopping giúp mô hình có đủ không gian hội tụ. |
| **Early Stopping Patience** | `2` | Theo dõi Validation Macro F1. Nếu 2 Epochs liên tiếp không tăng thêm thì ngắt train tự động, chống Overfitting. |
| **Learning Rate** | `1.5e-5` | PhoBERT-large cần mức Learning Rate nhỏ hơn bản Base (1.5e-5) để trọng số cập nhật mịn màng. |
| **Warmup Ratio** | `0.1` | Dành 10% tổng số steps để tăng dần Learning Rate từ 0 $\rightarrow$ 1.5e-5, tránh trôi trọng số đột ngột. |
| **LR Scheduler Type** | `cosine` | Giảm dần Learning Rate theo đường cong Cosine Annealing giúp mô hình hội tụ sâu ở các bước cuối. |
| **Weight Decay** | `0.01` | Regularization L2 giúp phạt các trọng số quá lớn, giảm Overfitting. |
| **Batch Size & Accumulation** | `batch_size=8`, `gradient_accumulation_steps=2` | Tương đương Effective Batch Size = 16, tối ưu vừa khít 16GB VRAM GPU T4 trên Colab. |
| **Precision** | `fp16 = True` | Mixed Precision Float16 giúp tăng tốc độ train và tiết kiệm VRAM. |
| **Loss Function** | `Weighted CrossEntropy` | Phạt nặng gấp 1.5 - 1.7 lần khi mô hình đoán sai các nhãn khó `Disgust` và `Other`. |
| **Best Model Metric** | `f1 (Macro F1)` | Ép mô hình tối ưu hóa đồng đều cả 7 nhãn thay vì chỉ ưu tiên nhãn đa số. |

---

## 3. QUY TRÌNH THỰC THI THỰC NGHIỆM TRÊN GOOGLE COLAB (STEP-BY-STEP V2)

Toàn bộ quy trình được tự động hóa trong Notebook `finetune_phobert_emotion_v2.ipynb`:

1. **Step 1: Khởi tạo & Cài đặt môi trường**:
   - Cài đặt `transformers`, `datasets`, `accelerate`, `torch`, `scikit-learn`, `matplotlib`.
2. **Step 2: Nạp dữ liệu pre-split đã tinh lọc sạch**:
   - Tải 3 file `phobert_train.json` (6,913 mẫu), `phobert_val.json` (1,482 mẫu), `phobert_test.json` (1,482 mẫu) lên Colab và nạp vào bộ nhớ.
3. **Step 3: Tokenize & Chuyển đổi PyTorch Dataset**:
   - Sử dụng `AutoTokenizer.from_pretrained("vinai/phobert-large")` để tokenize dữ liệu với `max_length=128`.
4. **Step 4: Huấn luyện với WeightedLossTrainer & Dừng sớm (Early Stopping)**:
   - Chạy `trainer.train()` với `WeightedLossTrainer` và `EarlyStoppingCallback(patience=2)`. Checkpoint tối ưu nhất được tự động lưu ra `./phobert_emotion_final`.
5. **Step 5: Đánh giá Độc lập & Đóng gói Checkpoint Export**:
   - Chạy `trainer.predict(test_ds)` trên tập Test độc lập (1,482 mẫu), in báo cáo `classification_report` và nén file `phobert_emotion_final.zip`.
6. **Step 6: Trực quan hóa Đường cong Huấn luyện (Learning Curves)**:
   - Trích xuất `log_history` và vẽ đồ thị biểu diễn `Validation Macro F1` và `Validation Loss` lưu thành ảnh `training_performance_curves.png`.
