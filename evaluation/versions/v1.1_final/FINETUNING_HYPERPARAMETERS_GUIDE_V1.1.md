# HƯỚNG DẪN CHI TIẾT & PHƯƠNG PHÁP LUẬN FINETUNING PHOBERT-BASE EMOTION (VERSION 1.1 OPTIMIZED)

Tài liệu này trình bày phương pháp luận khoa học, cơ sở lý thuyết, giải thích các siêu tham số (Hyperparameters), kiến trúc **Inverse Class-Weighted Loss Trainer** và hướng dẫn thực thi notebook `finetune_phobert_emotion_v1.1.ipynb` trên **Google Colab (T4 GPU)**.

---

## 1. PHƯƠNG PHÁP LUẬN KHOA HỌC & KIẾN TRÚC MÔ HÌNH PHOBERT-BASE

### 1.1 Mô hình Nền tảng PhoBERT-Base (`vinai/phobert-base-v2`)
* **Kiến trúc**: Dựa trên kiến trúc **RoBERTa** (Liu et al., 2019) với **135 triệu tham số (135M Parameters)** được pre-trained trên **20GB ngữ liệu tiếng Việt chuẩn** (Nguyen & Nguyen, EMNLP 2020).
* **Ưu điểm**: Sử dụng BPE subword segmentation tối ưu hóa cho tiếng Việt. Dung lượng 135M tham số **vừa khít với quy mô dữ liệu ~10,000 mẫu**, giúp mô hình đạt độ tổng quát hóa (Generalization) cao nhất mà không bị Overfitting như các mô hình quá lớn (PhoBERT-Large 370M).

### 1.2 Kiến trúc Inverse Class-Weighted CrossEntropy Loss Trainer
Do nhãn `Other` (Khác/Mơ hồ) và `Disgust` (Khinh bỉ) có F1-score thấp hơn các nhãn khác, notebook V1.1 tích hợp custom class-weights tính theo nghịch đảo tần suất lớp (Inverse Class Frequency) vào hàm Loss CrossEntropy:
$$\mathcal{L} = -\sum_{i=1}^{N} w_i \cdot y_i \log(\hat{y}_i)$$
Trong đó trọng số phạt được thiết lập mịn màng: `class_weights = [Enjoyment: 1.0, Sadness: 1.05, Disgust: 1.25, Anger: 1.1, Fear: 1.15, Surprise: 1.2, Other: 1.35]`.

---

## 2. CHI TIẾT BẢNG SIÊU THAM SỐ (HYPERPARAMETERS) & LÝ DO CHỌN

| Siêu Tham Số (Hyperparameter) | Giá Trị Thiết Lập | Cơ Sở Khoa Học & Lý Do Lựa Chọn |
| :--- | :---: | :--- |
| **Base Model** | `vinai/phobert-base-v2` | Mô hình ngôn ngữ RoBERTa Tiếng Việt chuẩn nhất hiện nay với 135M tham số. |
| **Max Length** | `128` | Bảo toàn 100% ngữ cảnh câu văn mạng xã hội mà không gây lãng phí VRAM GPU. |
| **Max Train Epochs** | `8` | Đặt trần 8 Epochs tối ưu vừa đủ cho PhoBERT-Base hội tụ đỉnh cao. |
| **Early Stopping Patience** | `2` | Theo dõi Validation Macro F1. Nếu 2 Epochs liên tiếp không tăng thêm thì ngắt train tự động (dừng ở Epoch 4-6). |
| **Learning Rate** | `2e-5` | Mức Learning Rate tiêu chuẩn vàng cho fine-tune BERT (2e-5), giúp trọng số cập nhật mịn màng. |
| **Warmup Steps** | `300` | Dành 300 steps đầu để tăng dần Learning Rate từ 0 $\rightarrow$ 2e-5, tránh trôi trọng số đột ngột (gradient shock). |
| **LR Scheduler Type** | `cosine` | Giảm dần Learning Rate theo đường cong Cosine Annealing giúp mô hình hội tụ sâu ở các bước cuối. |
| **Weight Decay** | `0.01` | Regularization L2 tiêu chuẩn giúp phạt các trọng số quá lớn, giảm Overfitting. |
| **Batch Size** | `16` | Tối ưu hóa bộ nhớ GPU Colab T4 (16GB VRAM), giúp gradient cập nhật cực kỳ ổn định. |
| **Precision** | `fp16 = True` | Mixed Precision Float16 giúp tăng tốc độ train 2.5 lần và tiết kiệm VRAM. |
| **Loss Function** | `Weighted CrossEntropy` | Phạt trọng số nghịch đảo `[1.0, 1.05, 1.25, 1.1, 1.15, 1.2, 1.35]` giúp cứu các nhãn khó `Disgust` & `Other`. |
| **Best Model Metric** | `f1 (Macro F1)` | Ép mô hình tối ưu hóa đồng đều cả 7 nhãn thay vì chỉ ưu tiên nhãn đa số. |

---

## 3. QUY TRÌNH THỰC THI THỰC NGHIỆM TRÊN GOOGLE COLAB (STEP-BY-STEP V1.1)

Toàn bộ quy trình được tự động hóa trong Notebook `finetune_phobert_emotion_v1.1.ipynb`:

1. **Step 1: Khởi tạo & Cài đặt môi trường**:
   - Cài đặt `transformers`, `datasets`, `accelerate`, `torch`, `scikit-learn`, `matplotlib`.
2. **Step 2: Nạp dữ liệu pre-split đã tinh lọc sạch**:
   - Tải 3 file `phobert_train.json` (6,913 mẫu), `phobert_val.json` (1,482 mẫu), `phobert_test.json` (1,482 mẫu) lên Colab và nạp vào bộ nhớ.
3. **Step 3: Tokenize & Chuyển đổi PyTorch Dataset**:
   - Sử dụng `AutoTokenizer.from_pretrained("vinai/phobert-base-v2")` để tokenize dữ liệu với `max_length=128`.
4. **Step 4: Huấn luyện với WeightedLossTrainer & Dừng sớm (Early Stopping)**:
   - Chạy `trainer.train()` với `WeightedLossTrainer` và `EarlyStoppingCallback(patience=2)`. Checkpoint tối ưu nhất được tự động lưu ra `./phobert_emotion_final`.
5. **Step 5: Đánh giá Độc lập & Đóng gói Export**:
   - Chạy `trainer.predict(test_ds)` trên tập Test độc lập (1,482 mẫu), in báo cáo `classification_report` và xuất ra `test_log.txt`.
6. **Step 6: Trực quan hóa Biểu đồ & Tự động Download Package**:
   - Trích xuất `log_history` vẽ đồ thị `training_performance_curves.png`, đóng gói file `phobert_emotion_final.zip` và kích hoạt tự động tải về máy tính cá nhân!
