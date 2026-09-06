# Hướng Dẫn Huấn Luyện & Báo Cáo Cải Tiến Kỹ Thuật (PhoBERT Moderation v1.1)

Thư mục này chứa file notebook huấn luyện **`finetune_phobert_moderation_v1.1.ipynb`** và báo cáo kỹ thuật về thử nghiệm cải tiến v1.1 trên mô hình **PhoBERT Multi-Label Text Moderation**.

---

## 🏗️ 1. Điểm Khác Biệt & Cải Tiến So Với Bản v1.0

| Hạng mục | Bản v1.0 (Baseline) | Bản v1.1 (Undersampled CLEAN & Loss Early Stop) | Lý do cải tiến |
| :--- | :---: | :---: | :--- |
| **Dữ liệu `CLEAN`** | **$27,623$ mẫu** ($76.9\%$) | **$8,000$ mẫu** ($49.1\%$) | Loại bỏ hiện tượng class bias (mô hình lười đoán `CLEAN`), buộc AI phải tập trung học đặc trưng vi phạm. |
| **Tổng số lượng mẫu** | $35,893$ mẫu | **$16,270$ mẫu** | Giảm $54.6\%$ quy mô tập train, giúp thời gian train giảm từ 16 phút $\rightarrow$ **6 phút**. |
| **Chiến lược Early Stopping** | Theo dõi `macro_f1` (Epochs 5) | Theo dõi **`eval_loss`** (Patience = 2) | Khắc phục hiện tượng Overfitting ở Epoch 3 của bản v1.0, tự động lấy checkpoint tốt nhất ở Epoch 2. |
| **Vị trí lưu dữ liệu** | `data/` | **`data/v1.1/`** | Phân tách không gian dữ liệu rõ ràng giữa các phiên bản. |

---

## 🔬 2. Cơ Sở Khoa Học Của Việc Đặt `num_train_epochs = 5` Kết Hợp `EarlyStoppingCallback`

Việc đặt `num_train_epochs = 5` **KHÔNG CÓ NGHĨA LÀ BẮT MÔ HÌNH CHẠY HẾT 5 EPOCHS**, mà đó là **TRẦN UPPER BOUND AN TOÀN** trong thiết lập huấn luyện Transfer Learning cho Transformer (Devlin et al., 2019; Dodge et al., 2020):

### A. Thực nghiệm thực tế từ bản v1.0 (Empirical Evidence)
* Ở bản v1.0, kết quả cho thấy:
  - **Epoch 1**: `val_loss = 0.406`
  - **Epoch 2**: `val_loss = 0.333` $\leftarrow$ **Đỉnh điểm tối ưu (Optimal Point)**
  - **Epoch 3**: `val_loss = 0.366` $\uparrow$ (Tăng loss - Bắt đầu Overfitting)
  - **Epoch 4**: `val_loss = 0.379` $\uparrow$ (Overfitting tiếp tục)
* **Kết luận thực nghiệm**: Mô hình PhoBERT đã đạt điểm hội tụ tối ưu ngay tại **Epoch 2**. Do đó, mô hình thực chất chỉ cần chạy $2 \rightarrow 3$ epochs là dừng.

### B. Lý do chọn `num_train_epochs = 5` thay vì đặt cứng = 2
1. **Tránh thiếu epoch nếu tập v1.1 hội tụ chậm hơn**: Khi dữ liệu `CLEAN` bị cắt giảm từ $27k \rightarrow 8k$, phân bố dữ liệu thay đổi. Đặt `epochs = 5` làm **giới hạn trần (Upper Bound)** giúp mô hình có đủ không gian mở rộng nếu cần học tới Epoch 3 hoặc 4.
2. **Cơ chế kiểm soát bằng `EarlyStoppingCallback(early_stopping_patience=2, metric_for_best_model="eval_loss")`**:
   - Khi mô hình bắt đầu bị tăng `val_loss` ở Epoch 3 và 4 (như bản v1.0), `EarlyStoppingCallback` sẽ **tự động cắt đứt quá trình train ngay lập tức** mà không chạy tiếp các epoch thừa.
   - Hàm `load_best_model_at_end=True` sẽ **tự động loại bỏ trọng số bị overfitting của Epoch 3, 4, 5** và khôi phục đúng trọng số chuẩn nhất tại Epoch 2.

👉 **Tóm lại**: `num_train_epochs = 5` đóng vai trò là "lưới an toàn" (Max Limit), còn `EarlyStoppingCallback` mới là người thực sự quyết định mô hình dừng ở đâu (thường là Epoch 2 hoặc 3).

---

## 📊 3. Phân Phối Dữ Liệu Tập v1.1 (Stratified 70-15-15)

* **Train Set (70%)**: **$11,389$ mẫu**
* **Validation Set (15%)**: **$2,440$ mẫu**
* **Test Set (15%)**: **$2,441$ mẫu**

| Nhãn Moderation | Train | Val | Test | Tổng số mẫu |
| :--- | :---: | :---: | :---: | :---: |
| **0: `CLEAN`** | $5,600$ | $1,200$ | $1,200$ | **$8,000$** |
| **1: `PROFANITY_VENTING`** | $1,583$ | $339$ | $339$ | **$2,261$** |
| **2: `HATE_SPEECH`** | $2,460$ | $527$ | $527$ | **$3,514$** |
| **3: `SELF_HARM_CRISIS`** | $1,746$ | $374$ | $375$ | **$2,495$** |
| **Tổng cộng** | **$11,389$** | **$2,440$** | **$2,441$** | **$16,270$** |

---

## 🚀 4. Hướng Dẫn Chạy Train v1.1 Trên Google Colab

1. **Chuẩn bị dữ liệu v1.1**: Tải 3 file `train.json`, `val.json`, `test.json` từ thư mục `evaluation/moderation/data/v1.1/`.
2. **Tải lên Colab**: Mở Google Colab (T4 GPU), tải file `finetune_phobert_moderation_v1.1.ipynb` và kéo thả 3 file `.json` vừa tải vào thư mục root.
3. **Chạy huấn luyện**: Chọn **Runtime -> Run all**. Mô hình sẽ tự động huấn luyện, dừng trước khi Overfitting và tải về file `saved_phobert_moderation_v1.1.zip`.
