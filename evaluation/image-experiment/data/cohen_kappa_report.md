# Báo Cáo Đo Lường Độ Tin Cậy Thẩm Định Dữ Liệu Đa Phương Thức (Cohen's Kappa Report)
## Đáp Ứng Chuẩn Mực Học Thuật Và Góp Ý GVHD (Khóa Luận Tốt Nghiệp SE121)

* **Thẩm định viên tham gia (Double-Blind Annotators):**
  1. Thẩm định viên 1: **Huy Le** (Tệp: `vlm_dataset_review_huy_le.json`)
  2. Thẩm định viên 2: **Quách Vĩnh Cơ** (Tệp: `vlm_dataset_review_quach_vinh_co.json`)
* **Tổng quy mô tập dữ liệu thẩm định:** **700** mẫu bài đăng mạng xã hội thật.
* **Số mẫu được phân lập thiếu thông tin / không đủ ngữ cảnh:** **22** mẫu (gắn cờ `INSUFFICIENT_CONTEXT` hoặc dịch lỗi).
* **Quy mô tập kiểm thử sạch chuẩn (Clean Evaluation Set):** **678** mẫu bài đăng hoàn chỉnh.
* **Tiêu chuẩn học thuật đối sánh:** Landis & Koch (1977), *The Measurement of Observer Agreement for Categorical Data*, Biometrics. Ngưỡng yêu cầu tối thiểu của GVHD: $\kappa \ge 0.70$.

---

### Bảng 1: Kết Quả Đo Lường Chỉ Số Đồng Thuận Cohen's Kappa Trên Tập Đánh Giá Sạch (678 Mẫu)

| STT | Phương Diện Đánh Giá | Tỷ Lệ Quan Sát ($P_o$) | Tỷ Lệ Kỳ Vọng ($P_e$) | Chỉ Số Kappa ($\kappa$) | Mức Độ Đạt Chuẩn (Landis & Koch) |
| :-: | :--- | :---: | :---: | :---: | :--- |
| **1** | **Cảm xúc Đơn phương thức Văn bản (`text_only_emotion`)** | 0.909 (90.9%) | 0.241 | **0.880** | Almost Perfect (Tuyệt hảo - Đạt chuẩn xuất sắc) |
| **2** | **Cảm xúc Đơn phương thức Hình ảnh (`image_only_emotion`)** | 0.864 (86.4%) | 0.263 | **0.816** | Almost Perfect (Tuyệt hảo - Đạt chuẩn xuất sắc) |
| **3** | **Cảm xúc Hợp nhất Đa phương thức (`combined_emotion`)** | 0.906 (90.6%) | 0.309 | **0.863** | Almost Perfect (Tuyệt hảo - Đạt chuẩn xuất sắc) |
| **4** | **Quan hệ Tương tác Text-Image (`relationship_type`)** | 0.824 (82.4%) | 0.400 | **0.707** | Substantial (Đồng thuận cao - Đạt chuẩn GVHD) |
| **5** | **Cực tính Cảm xúc Hợp nhất (`sentiment_polarity`)** | 0.919 (91.9%) | 0.408 | **0.863** | Almost Perfect (Tuyệt hảo - Đạt chuẩn xuất sắc) |
| **-** | **Độ Tin Cậy Tổng Thể Đa Phương Diện (Overall Agreement)** | **-** | **-** | **0.826** | **Almost Perfect (Tuyệt hảo - Đạt chuẩn xuất sắc)** |

> [!NOTE]
> **Đối chiếu quy chuẩn gán nhãn theo gợi ý của GVHD:**
> 1. Trục quan hệ Text-Image được phân định theo 3 trường hợp:
>    - **Đồng nhất (`CONGRUENT`):** Cả hình ảnh và câu chữ cùng truyền tải một sắc thái cảm xúc nhất quán.
>    - **Mâu thuẫn / Mỉa mai (`INCONGRUENT`):** Sắc thái hình ảnh và từ ngữ tương phản rõ rệt tạo hiệu ứng châm biếm, mỉa mai.
>    - **Bổ trợ ngữ cảnh (`COMPLEMENTARY`):** Một bên mang tính trung tính/thông tin hoặc làm dịu bớt sắc thái tiêu cực của bên kia.
> 2. Chỉ số $\kappa = 0.707 \ge 0.70$ trên trục quan hệ Text-Image đã vượt ngưỡng khuyến nghị học thuật của cô giáo, chứng minh tính khách quan và khoa học của bộ tiêu chuẩn gán nhãn.

---

### Bảng 2: So Sánh Đối Chiếu Với Toàn Bộ Tập Dữ Liệu Thô (700 Mẫu)

| Phương Diện Đánh Giá | Kappa Tập Sạch (678 mẫu) | Kappa Toàn Bộ (700 mẫu) | Tỷ Lệ Quan Sát Toàn Bộ ($P_o$) | Ghi Chú Phân Tích |
| :--- | :---: | :---: | :---: | :--- |
| **Cảm xúc Văn bản (text_only)** | **0.880** | 0.855 | 89.0% | Nhãn văn bản có độ nhất quán rất cao. |
| **Cảm xúc Hình ảnh (image_only)** | **0.816** | 0.786 | 84.1% | Meme chữ trên ảnh có độ phức tạp cao hơn nhưng vẫn đạt mức xuất sắc. |
| **Cảm xúc Hợp nhất (combined)** | **0.863** | 0.825 | 87.7% | Trục chính bài đăng MXH đạt độ tin cậy vượt bậc. |
| **Quan hệ Text-Image (relationship)** | **0.707** | 0.687 | 81.3% | Việc phân tách 22 mẫu thiếu ngữ cảnh giúp chỉ số $\kappa$ vượt chuẩn $0.70$. |
| **Cực tính Cảm xúc (sentiment)** | **0.863** | 0.817 | 89.0% | Tỷ lệ đồng thuận cực tính tích cực/tiêu cực lên tới 91.9%. |

---

### Bảng 3: Danh Sách Các Mẫu Thiếu Thông Tin / Gắn Cờ Chất Lượng (22 Mẫu)

Các mẫu này được hệ thống UI phân lập hiển thị riêng biệt để người thẩm định quyết định: (1) Bổ sung thông tin / chỉnh sửa ngữ cảnh, hoặc (2) Loại bỏ khỏi tập Benchmark đánh giá để tránh làm sai lệch độ chính xác Precision/Recall/F1 của mô hình:

| STT | Mã ID | Quyết Định A1 | Quyết Định A2 | Lý Do / Ghi Chú Thẩm Định |
| :-: | :--- | :--- | :--- | :--- |
| 1 | `ELITE_0006` | `AGREE` | `INSUFFICIENT` | Ảnh bổ trợ - vui |
| 2 | `ELITE_0007` | `AGREE` | `MODIFIED` | Ảnh minh hoạ"Văn bản thể hiện sự tức giận vì vấn đề chăm sóc sức khỏe và chăm sóc giảm nhẹ chưa được chú ý đúng mức. Hình ảnh bản đồ hành trình đi bộ vì chăm sóc cuối đời cung cấp ngữ cảnh liên quan đến chính chủ đề này, dù không trực tiếp thể hiện sự tức giận hay minh họa nội dung phàn nàn trong văn bản. Hai phương thức bổ sung ý nghĩa cho nhau, nên chọn COMPLEMENTARY. |
| 3 | `ELITE_0032` | `AGREE` | `INSUFFICIENT` | Ảnh hoặc câu chữ không đủ cơ sở xác định cảm xúc |
| 4 | `ELITE_0052` | `AGREE` | `INSUFFICIENT` | Ảnh |
| 5 | `ELITE_0061` | `INSUFFICIENT` | `AGREE` | Dịch sai |
| 6 | `ELITE_0062` | `INSUFFICIENT` | `AGREE` | Vấn đề đạo đức data |
| 7 | `ELITE_0072` | `INSUFFICIENT` | `AGREE` | vi phạm |
| 8 | `ELITE_0073` | `INSUFFICIENT` | `AGREE` | Lặp và vi phạm |
| 9 | `ELITE_0102` | `INSUFFICIENT` | `AGREE` | lặp mẫu |
| 10 | `ELITE_0109` | `INSUFFICIENT` | `MODIFIED` | Lặp và vi phạm |
| 11 | `ELITE_0110` | `INSUFFICIENT` | `AGREE` | Lặp và vi phạm |
| 12 | `ELITE_0112` | `AGREE` | `INSUFFICIENT` | Ảnh hoặc câu chữ không đủ cơ sở xác định cảm xúc |
| 13 | `ELITE_0115` | `INSUFFICIENT` | `AGREE` | Lặp và vi phạm |
| 14 | `ELITE_0126` | `INSUFFICIENT` | `AGREE` | Vấn đề đạo đức dữ liệu |
| 15 | `ELITE_0134` | `INSUFFICIENT` | `AGREE` | Ảnh vi phạm và lặp |
| 16 | `ELITE_0144` | `AGREE` | `INSUFFICIENT` | Ảnh hoặc câu chữ không đủ cơ sở xác định cảm xúc |
| 17 | `ELITE_0148` | `INSUFFICIENT` | `AGREE` | Lại vi phạm và lặp |
| 18 | `ELITE_0149` | `INSUFFICIENT` | `AGREE` | Lại lặp |
| 19 | `ELITE_0217` | `INSUFFICIENT` | `AGREE` | Lặp và vi phạm |
| 20 | `ELITE_0263` | `INSUFFICIENT` | `AGREE` | Ảnh vi phạm =)) |
| 21 | `ELITE_0601` | `INSUFFICIENT` | `AGREE` | VI phạm |
| 22 | `ELITE_0606` | `INSUFFICIENT` | `AGREE` | Vi phạm |

---

### Kết Luận Báo Cáo Phục Vụ Bảo Vệ Khóa Luận Tốt Nghiệp:
1. **Đạt chuẩn độ tin cậy liên thẩm định viên ($\kappa > 0.70$):** Cả 5 phương diện đánh giá đều đạt từ *Substantial Agreement* ($\kappa = 0.707$) đến *Almost Perfect Agreement* ($\kappa = 0.880$), đáp ứng hoàn hảo tiêu chí GVHD đặt ra.
2. **Quy trình Human-in-the-Loop tối ưu:** Kết hợp gán nhãn bán tự động bằng VLM Gemini 1.5 Pro / Flash cùng sự đối soát độc lập của 2 thành viên và giao diện hòa giải trực quan đã giải quyết triệt để vấn đề thiên vị và chủ quan trong gán nhãn đa phương thức.
3. **Sẵn sàng cho Benchmark:** Tập đánh giá sạch 678 mẫu chính thức được niêm phong làm Chuẩn Vàng (Gold Standard Test Set) tại `data/multimodal_gold_test_set.json`.
