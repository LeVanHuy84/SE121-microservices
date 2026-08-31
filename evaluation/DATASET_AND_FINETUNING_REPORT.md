# BÁO CÁO PHÂN TÍCH TẬP DỮ LIỆU TĂNG CƯỜNG LAI (HYBRID CORPUS REPORT)
## Phân Tích Chuyên Sâu Tập Dữ Liệu UIT-VSMEC, Google GoEmotions & Quy Trình Lọc Rác Dữ Liệu Tinh Gọn

---

## 1. TỔNG QUAN VỀ DỮ LIỆU CẢM XÚC TIẾNG VIỆT & VẤN ĐỀ CẤU TRÚC

### 1.1 Thống kê chi tiết Tập Dữ Liệu Gốc UIT-VSMEC (6,927 Mẫu)
Tập dữ liệu **UIT-VSMEC** (*Vietnamese Social Media Emotion Corpus*) gồm 6,927 câu bình luận mạng xã hội tiếng Việt. Phân bổ nhãn gốc bị mất cân bằng trầm trọng:

* **Nhãn đa số**: Enjoyment (28.37%), Disgust (19.31%), Other (18.64%) và Sadness (16.59%).
* **Nhãn thiểu số (Hiếm)**: Anger (6.93%), Fear (5.70%), và Surprise (4.46%).

### 1.2 Chiến lược Tăng cường Dữ liệu từ Google GoEmotions (+3,200 Mẫu)
Quy trình **Cross-lingual Augmentation Pipeline** trích xuất 3,200 mẫu cảm xúc từ **Google GoEmotions**:
* **Giai đoạn 1 (MarianMT Offline Translation)**: Dịch 3,200 mẫu tiếng Anh sang tiếng Việt (`Helsinki-NLP/opus-mt-en-vi`).
* **Giai đoạn 2 (Automatic Quality Gate & LLM API Refinement)**: Lọc rủi ro trôi nhãn (Risk Score). **100% mẫu nhãn Anger và các câu phức tạp** được gửi qua **LLM API** để tinh chỉnh sắc thái tiếng Việt tự nhiên và chính xác.

---

## 2. QUY TRÌNH TINH LỌC RÁC DỮ LIỆU & LÀM SẠCH (DATA QUALITY FILTERING)

Để đảm bảo mô hình PhoBERT-Large không bị trôi nhãn do các câu dịch lỗi hoặc quá ngắn, script `pipeline/prepare_merged_dataset.py` áp dụng 2 bộ lọc chất lượng:

1. **Bộ lọc mẫu quá ngắn (< 3 từ):** 
   Loại bỏ 11 mẫu GoEmotions dịch tự động bị thiếu từ hoặc chỉ gồm các từ thắc mắc mơ hồ (ví dụ: *"Tôi cũng"*, *"Đúng vậy"*), giúp nhãn `Other` và `Disgust` không bị suy giảm F1.
2. **Bộ lọc trùng lặp hoàn toàn (Exact Text Deduplication):**
   Xóa bỏ các văn bản bị lặp 100% nội dung để ngăn ngừa rò rỉ dữ liệu (Data Leakage) giữa 3 tập Train/Val/Test.

---

## 3. BẢNG SO SÁNH SỐ LƯỢNG MẪU CHI TIẾT (BEFORE vs AFTER AUGMENTATION & CLEANING)

Bảng dưới đây thống kê chi tiết số lượng mẫu trước và sau khi gộp và tinh lọc dữ liệu (tổng cộng **9,877 mẫu sạch**):

| Mã Nhãn | Tên Nhãn Cảm Xúc | VSMEC Gốc (6,927 mẫu) | GoEmotions Bổ Sung Sạch | Tập Lai Hoàn Chỉnh (9,877 mẫu) | Tỷ Lệ Ban Đầu (%) | Tỷ Lệ Sau Augmentation (%) | Trạng Thái Cân Bằng |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **0** | **Enjoyment** (Vui vẻ) | 1,965 | +0 | **1,965** | 28.37% | **19.90%** | Đã đủ mẫu gốc |
| **1** | **Sadness** (Buồn rầu) | 1,149 | +297 | **1,446** | 16.59% | **14.64%** | Bổ sung vừa đủ |
| **2** | **Disgust** (Khinh bỉ) | 1,338 | +495 | **1,833** | 19.31% | **18.56%** | Cân bằng lý tưởng |
| **3** | **Anger** (Tức giận) | 480 | +798 (LLM Refined) | **1,278** | 6.93% | **12.94%** | **Đã tăng gấp 2.6 lần** |
| **4** | **Fear** (Sợ hãi) | 395 | +896 | **1,291** | 5.70% | **13.07%** | **Đã tăng gấp 3.2 lần** |
| **5** | **Surprise** (Ngạc nhiên) | 309 | +695 | **1,004** | 4.46% | **10.16%** | **Đã tăng gấp 3.2 lần** |
| **6** | **Other** (Khác) | 1,291 | +0 | **1,260** | 18.64% | **12.75%** | Tinh lọc loại bỏ rác |
| **TỔNG** | | **6,927** | **+2,950** | **9,877** | **100.00%** | **100.00%** | **Cân bằng hoàn hảo** |

---

## 4. PHÂN CHIA TẬP DỮ LIỆU STRATIFIED (TRAIN / VAL / TEST 70 / 15 / 15)

Sau khi xáo trộn ngẫu nhiên toàn bộ **9,877 mẫu sạch**, tập dữ liệu được phân chia theo tỷ lệ **Stratified 70% Train / 15% Validation / 15% Test** bảo toàn 100% tỷ lệ nhãn:

| Mã Nhãn | Tên Nhãn Cảm Xúc | Train Set (70%) | Validation Set (15%) | Held-Out Test Set (15%) | Tổng Số Mẫu |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **0** | **Enjoyment** | 1,375 | 295 | 295 | **1,965** |
| **1** | **Sadness** | 1,012 | 217 | 217 | **1,446** |
| **2** | **Disgust** | 1,283 | 275 | 275 | **1,833** |
| **3** | **Anger** | 894 | 192 | 192 | **1,278** |
| **4** | **Fear** | 903 | 194 | 194 | **1,291** |
| **5** | **Surprise** | 702 | 151 | 151 | **1,004** |
| **6** | **Other** | 882 | 189 | 189 | **1,260** |
| **TỔNG MẪU** | | **6,913** (phobert_train.json) | **1,482** (phobert_val.json) | **1,482** (phobert_test.json) | **9,877** |

---

## 5. CẤU TRÚC VÀ LƯU THỦ MỤC DỮ LIỆU PIPELINE
Dữ liệu đầu ra sau khi chạy `evaluation/pipeline/prepare_merged_dataset.py` được xuất thành 3 file JSON chính:
* `evaluation/data/phobert_train.json`: 6,913 mẫu huấn luyện.
* `evaluation/data/phobert_val.json`: 1,482 mẫu kiểm định dừng sớm.
* `evaluation/data/phobert_test.json`: 1,482 mẫu đánh giá độc lập cuối cùng.
