# HƯỚNG DẪN CHI TIẾT & PHƯƠNG PHÁP LUẬN FINETUNING PHOBERT EMOTION

Tài liệu này trình bày phương pháp luận khoa học, cơ sở lý thuyết, giải thích các siêu tham số (Hyperparameters) và hướng dẫn thực thi notebook finetune_phobert_emotion.ipynb.

---

## 1. PHƯƠNG PHÁP LUẬN KHOA HỌC & KIẾN TRÚC MÔ HÌNH

### 1.1 Mô hình Nền tảng PhoBERT (vinai/phobert-base-v2)
* **Kiến trúc**: Dựa trên kiến trúc **RoBERTa** (Liu et al., 2019) được pre-trained trên **20GB ngữ liệu tiếng Việt chuẩn** (Nguyen & Nguyen, EMNLP 2020).
* **Ưu điểm**: Sử dụng BPE subword segmentation giúp khắc phục triệt để vấn đề từ Out-Of-Vocabulary (OOV) và nắm bắt ngữ cảnh cú pháp tiếng Việt vượt trội.

### 1.2 Kiến trúc Phân loại Cảm xúc 7 Lớp (Sequence Classification Head)
Phía trên PhoBERT base, một đầu phân loại tuyến tính (Linear Classifier) được gắn vào token đại diện ngữ cảnh [CLS] để phân loại 7 lớp cảm xúc.

---

## 2. CHI TIẾT BẢNG SIÊU THAM SỐ (HYPERPARAMETERS) & LÝ DO CHỌN

| Siêu Tham Số (Hyperparameter) | Giá Trị Thiết Lập | Cơ Sở Khoa Học & Lý Do Lựa Chọn |
| :--- | :---: | :--- |
| Base Model | vinai/phobert-base-v2 | Mô hình ngôn ngữ RoBERTa tiếng Việt chuẩn nhất hiện nay. Bản v2 tối ưu thuật toán BPE tách từ. |
| Max Length | 128 | Độ dài câu sau khi làm sạch dao động 15-50 tokens. Ngưỡng 128 bảo toàn 100% ngữ cảnh mà không làm tốn VRAM GPU. |
| Max Train Epochs | 10 | Đặt ngưỡng tối đa 10 Epochs kết hợp với Early Stopping giúp mô hình học đủ sâu ngữ cảnh cảm xúc. |
| Early Stopping Patience | 5 | Theo dõi Validation Macro F1. Nếu 5 Epochs liên tiếp không tăng thêm thì ngắt train tự động, loại bỏ nguy cơ Overfitting. |
| Learning Rate | 2e-5 | Mức Learning Rate tiêu chuẩn vàng cho fine-tune BERT (2e-5), giúp trọng số cập nhật mịn màng. |
| Warmup Steps | 500 | Dành 500 steps đầu để tăng dần Learning Rate từ 0 -> 2e-5, tránh trôi trọng số đột ngột (gradient shock). |
| Weight Decay | 0.01 | Regularization L2 giúp phạt các trọng số quá lớn, giảm Overfitting. |
| Batch Size | 16 | Tối ưu hóa bộ nhớ GPU Colab T4 (16GB VRAM), giúp gradient cập nhật ổn định. |
| Precision | fp16 = True | Mixed Precision Float16 giúp tăng tốc độ train 2.5 lần trên GPU T4. |
| Best Model Metric | f1 (Macro F1) | Ép mô hình tối ưu hóa đều cả 7 nhãn thay vì chỉ ưu tiên nhãn đa số. |
| Load Best Model at End | True | Tự động khôi phục lại checkpoint đạt F1 Validation cao nhất ở cuối quá trình train. |

---

## 3. QUY TRÌNH THỰC THI THỰC NGHIỆM TRÊN GOOGLE COLAB (STEP-BY-STEP)

Toàn bộ quy trình được tự động hóa trong Notebook finetune_phobert_emotion.ipynb:

1. **Step 1: Khởi tạo & Cài đặt môi trường**:
   - Cài đặt transformers, datasets, accelerate, torch.
2. **Step 2: Nạp dữ liệu pre-split**:
   - Tải 3 file phobert_train.json, phobert_val.json, phobert_test.json lên Colab và nạp vào bộ nhớ.
3. **Step 3: Tokenize & Chuyển đổi PyTorch Dataset**:
   - Sử dụng AutoTokenizer để chuyển văn bản câu thành Tensor IDs với padding/truncation max_length=128.
4. **Step 4: Huấn luyện & Dừng sớm (Trainer Execution)**:
   - Chạy Trainer.train() với Early Stopping theo dõi tập Validation. Checkpoint tối ưu được lưu ra ./phobert_emotion_final.
5. **Step 5: Đánh giá Độc lập & Đóng gói Checkpoint**:
   - Chạy trainer.predict(test_ds) trên tập Test (1,520 mẫu), in báo cáo classification_report và nén file phobert_emotion_final.zip.
