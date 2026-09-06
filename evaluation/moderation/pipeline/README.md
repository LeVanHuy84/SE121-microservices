# Moderation Data Pipeline (`evaluation/moderation/pipeline`)

Thư mục này chứa toàn bộ pipeline tự động hóa quy trình thu thập, trích xuất, dịch chuyển đổi dữ liệu tiếng Anh (Cross-lingual transfer), chuẩn hóa thuật ngữ tâm lý tiếng Việt và hợp nhất bộ dữ liệu huấn luyện cho mô hình **PhoBERT Multi-Label Moderation**.

---

## 🏗️ Kiến Trúc Các Script Trong Pipeline

Pipeline được thiết kế đồng bộ với `evaluation/pipeline` của hệ thống Emotion Analysis (sử dụng 100% LLM Translation + Instant Checkpoint Save):

```
evaluation/moderation/pipeline/
├── dataset_loader.py                    # Step 1: Nạp 33,400 mẫu baseline visolex/ViHSD từ Hugging Face
├── extract_english_selfharm.py          # Step 2: Trích xuất 2,500 mẫu Self-Harm tiếng Anh (Option A)
├── augment_selfharm_llm.py              # Step 3: Dịch trực tiếp 100% bằng LLM API (Venting Tone) + Realtime Checkpoint Save
└── prepare_merged_moderation_dataset.py # Step 4: Hợp nhất ViHSD + Data Self-Harm đã Việt hóa thành Dataset Multi-Label
```

---

## 📋 Mô Tả Từng Bước Thực Thi

### Step 1: Nạp Dữ Liệu Gốc ViHSD
```bash
python evaluation/moderation/pipeline/dataset_loader.py
```
* **Chức năng**: Kết nối Hugging Face Hub để lấy bộ dữ liệu ungated `visolex/ViHSD` (33,400 bình luận mạng xã hội Việt Nam) gồm 3 nhãn gốc (`0: CLEAN`, `1: OFFENSIVE`, `2: HATE`).

### Step 2: Trích Xuất Dữ Liệu Self-harm Tiếng Anh (Phương Án A)
```bash
python evaluation/moderation/pipeline/extract_english_selfharm.py
```
* **Chức năng**: Trích xuất đúng 2,500 câu chuẩn thuộc 2 nhóm (`1,000 SELF_HARM_EXPLICIT` + `1,500 DEPRESSION_VENTING`) từ bộ dữ liệu `ourafla/Mental-Health_Text-Classification_Dataset`. Lọc bỏ nhiễu Reddit (URLs, markdown, deleted posts).
* **Đầu ra**: File `evaluation/moderation/data/extracted_english_selfharm.json`.

### Step 3: Dịch 100% Trực Tiếp Bằng LLM & Lưu Checkpoint Liên Tục (`augment_selfharm_llm.py`)
```bash
python evaluation/moderation/pipeline/augment_selfharm_llm.py
```
* **Chức năng**: 
  * Dịch trực tiếp 2,500 câu tiếng Anh sang tiếng Việt tự nhiên theo đúng văn phong tâm sự/xả stress trên mạng xã hội Việt Nam bằng LLM API.
  * Loại bỏ triệt để hiện tượng dịch "lỏ" (ký hiệu âm nhạc `♪`, đảo ngược nghĩa).
  * Tự động gán các tên tiếng Việt thực tế (`Nam`, `Linh`, `Hùng`, `Phương`...) thay cho placeholder `[TÊN]`.
  * **Chế độ Checkpoint Tự Động**: Cứ dịch xong 5 mẫu sẽ tự động lưu thẳng xuống file `selfharm_vietnamese_augmented.json`. Nếu tiến trình bị ngắt/crash, khi chạy lại script sẽ tự động khôi phục vị trí và dịch tiếp tục mà không dịch lại các mẫu cũ.
* **Đầu ra**: File `evaluation/moderation/data/selfharm_vietnamese_augmented.json`.

### Step 4: Hợp Nhất Thành Tập Dữ Liệu Multi-Label Moderation (`prepare_merged_moderation_dataset.py`)
```bash
python evaluation/moderation/pipeline/prepare_merged_moderation_dataset.py
```
* **Chức năng**: Hợp nhất `visolex/ViHSD` + `selfharm_vietnamese_augmented.json` thành 1 tập dữ liệu thống nhất, chuẩn hóa teencode tiếng Việt và phân chia Train (80%) / Test (20%).
* **Đầu ra**: File `evaluation/moderation/data/merged_moderation_dataset.json`.

---

## 🏷️ Ma Trận Nhãn Đưa Vào Huấn Luyện (`PhoBERT Multi-Label Taxonomy`)

| Label ID | Nhãn Multi-Label | Định Nghĩa Nghiệp Vụ | Nguồn Dữ Liệu | Action Tương Ứng |
| :---: | :--- | :--- | :--- | :--- |
| **0** | **`CLEAN`** | Nội dung an toàn, tích cực. | ViHSD (`CLEAN`) | **ALLOW** |
| **1** | **`PROFANITY_VENTING`** | Từ chửi thề nhẹ / Bộc phát xả stress. | ViHSD (`OFFENSIVE`) | **ALLOW_WITH_WARNING** |
| **2** | **`HATE_SPEECH`** | Ngôn từ thù ghét / Công kích nặng. | ViHSD (`HATE`) | **HARD_BLOCK / SOFT_HIDE** |
| **3** | **`SELF_HARM_CRISIS`** | Ý định tự hại / Trầm cảm tuyệt vọng. | Translated English Self-Harm | **ALLOW_WITH_SUPPORT** |
| **4** | **`ILLEGAL_PORN`** | Đồi trụy / Vi phạm pháp luật nghiêm trọng. | Hard-block Engine / Synthetic | **HARD_BLOCK** |
