# BÁO CÁO PHÂN BỔ DỮ LIỆU ĐA PHƯƠNG THỨC (700 MẪU VLM BENCHMARK)

> **Dự án:** SE121 Microservices Platform — Mạng xã hội hỗ trợ Sức khỏe Tâm thần (KLTN)  
> **Tài liệu tham chiếu:** Chỉ đạo của GVHD tại [`teacher_response.md`](file:///D:/VsCode/NestJS/projects/SE121-microservices/docs/outputs/bao_cao_lan_4/teacher_response.md)  
> **Tệp dữ liệu phân tích:** [`evaluation/image-experiment/data/vlm_dataset.json`](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/image-experiment/data/vlm_dataset.json)  
> **Phạm vi báo cáo:** Tập trung tinh gọn vào đúng **2 trục đánh giá cốt lõi** theo yêu cầu của GVHD:
> 1. Quan hệ tương tác Ảnh – Chữ (`relationship_type` - 3 loại quan hệ).
> 2. Cảm xúc tổng thể bài đăng (`combined_emotion` - 7 nhãn Ekman).

---

## 1. TỔNG QUAN BỘ DỮ LIỆU BENCHMARK

| Tiêu chí | Giá trị | Đánh giá & Tiêu chuẩn chất lượng |
| :--- | :---: | :--- |
| **Quy mô tập Benchmark chính thức** | **700 mẫu** | Đạt chuẩn khuyến nghị của GVHD (nằm trong ngưỡng 500 – 1.000 mẫu test) |
| **Định danh mẫu** | `ELITE_0001` $\to$ `ELITE_0700` | Mã định danh chuẩn hóa duy nhất xuyên suốt pipeline |
| **Nguồn dữ liệu nền tảng** | MVSA-Single, MVSA-Multiple & Memotion 7k | Dữ liệu bài đăng mạng xã hội thật (Twitter/Meme) chuẩn quốc tế |
| **Độ toàn vẹn đa phương thức** | **100% (700/700)** | 100% có ảnh rõ nét tại `data/images/`, đầy đủ text gốc En và bản dịch tiếng Việt |
| **Tỷ lệ hợp lệ Schema** | **100% (700/700)** | 0 mẫu vi phạm cấu trúc hoặc rỗng trường dữ liệu |
| **Trạng thái VLM Pre-annotation** | **100% (700/700)** | Đã hoàn tất đề xuất sơ bộ bởi mô hình VLM kèm lời giải thích ngữ cảnh |
| **Tiến độ Human Review** | Đang tiến hành | Thẩm định độc lập 2 annotator qua Web UI để đo chỉ số Cohen's Kappa |

---

## 2. PHÂN BỔ 3 LOẠI QUAN HỆ ẢNH – CHỮ (`relationship_type`)

Đây là trục phân loại trọng tâm theo yêu cầu của GVHD nhằm kiểm thử năng lực kết hợp thông tin đa phương thức so với mô hình đơn phương thức truyền thống:

| Mối quan hệ Ảnh – Chữ | Số lượng mẫu | Tỷ lệ (%) | Đặc điểm & Cơ sở nhận diện |
| :--- | :---: | :---: | :--- |
| **`CONGRUENT` (Đồng nhất)** | **344** | **49.1%** | Cả ảnh và chữ cùng củng cố chung một thông điệp, cùng chung một hướng cảm xúc trực diện. |
| **`COMPLEMENTARY` (Bổ trợ ngữ cảnh)** | **246** | **35.1%** | Một bên trung tính/nêu sự kiện và bên kia bổ sung ngữ cảnh, đối tượng hoặc sắc thái cảm xúc cần thiết. |
| **`INCONGRUENT_SARCASTIC` (Mỉa mai / Mâu thuẫn)** | **110** | **15.7%** | Nghĩa đen câu chữ đối lập có chủ đích với hình ảnh (châm biếm, tự trào dí dỏm hoặc bức xúc). |
| **TỔNG CỘNG** | **700** | **100.0%** | **Cân đối và bao phủ đầy đủ cả 3 loại quan hệ theo đúng yêu cầu của GVHD.** |

---

## 3. PHÂN BỔ 7 NHÃN CẢM XÚC EKMAN TỔNG THỂ (`combined_emotion`)

Cảm xúc nổi trội thực tế mà người tiếp nhận có căn cứ để cảm nhận từ toàn bộ bài đăng (kết hợp cả Ảnh và Chữ):

| Nhãn Ekman | Số lượng mẫu | Tỷ lệ (%) | Phân tích đặc trưng bối cảnh mạng xã hội |
| :--- | :---: | :---: | :--- |
| **`joy`** (Vui vẻ, hào hứng) | **305** | **43.6%** | Chiếm tỷ trọng tự nhiên cao nhất trên MXH (thành tích, kỷ niệm, sự kiện vui vẻ). |
| **`anger`** (Tức giận, phẫn nộ) | **176** | **25.1%** | Phản đối gay gắt bất công xã hội, dịch vụ tồi tệ, trễ chuyến, tranh luận căng thẳng. |
| **`disgust`** (Kinh tởm, chê bai) | **71** | **10.1%** | Phản ứng bức xúc trước hành vi suy đồi, chế giễu phẩm giá, chê bai thậm tệ. |
| **`sadness`** (Buồn bã, thất vọng) | **49** | **7.0%** | Than thở cô đơn, tiếc nuối biến cố, chia sẻ mất mát, thất bại cá nhân. |
| **`neutral`** (Trung tính) | **43** | **6.1%** | Thông báo khách quan, phát ngôn chính sách, số liệu thống kê không thiên vị cảm xúc. |
| **`surprise`** (Ngạc nhiên, bất ngờ) | **32** | **4.6%** | Hiện tượng kỳ thú, bất ngờ trước biến cố đột ngột chưa lường trước. |
| **`fear`** (Sợ hãi, lo âu) | **24** | **3.4%** | Nỗi sợ thực tế, bất an về bệnh tật, ác mộng, cảnh báo nguy hiểm rùng rợn. |
| **TỔNG CỘNG** | **700** | **100.0%** | **Đầy đủ cả 7 nhãn Ekman; phân bổ tiệm cận dữ liệu mạng xã hội tự nhiên (In-the-wild).** |

---

## 4. MA TRẬN ĐỐI CHIẾU CHÉO (RELATIONSHIP TYPE × COMBINED EMOTION)

Bảng ma trận chéo thể hiện sự phân bổ 7 cảm xúc Ekman bên trong từng loại quan hệ đa phương thức trên toàn bộ 700 mẫu:

| Loại Quan Hệ Ảnh – Chữ | Joy | Anger | Disgust | Sadness | Neutral | Surprise | Fear | Tổng Mẫu |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`CONGRUENT`** | 174 | 73 | 19 | 25 | 31 | 8 | 14 | **344** |
| **`COMPLEMENTARY`** | 111 | 54 | 29 | 16 | 10 | 20 | 6 | **246** |
| **`INCONGRUENT_SARCASTIC`** | 20 | 49 | 23 | 8 | 2 | 4 | 4 | **110** |
| **TỔNG CỘNG** | **305** | **176** | **71** | **49** | **43** | **32** | **24** | **700** |

### Nhận xét chuyên môn từ ma trận chéo:
1. **`CONGRUENT` (344 mẫu - 49.1%)**: Trải đều ở mọi sắc thái nhưng chiếm ưu thế lớn ở `joy` (174 mẫu) và `anger` (73 mẫu), nơi cả ảnh và chữ đều đồng thanh thể hiện cùng một cảm xúc trực diện.
2. **`COMPLEMENTARY` (246 mẫu - 35.1%)**: Đóng vai trò cầu nối giải mã ngữ cảnh phong phú: bên cạnh `joy` (111 mẫu), quan hệ bổ trợ xuất hiện đậm nét ở `anger` (54 mẫu), `disgust` (29 mẫu) và `surprise` (20 mẫu).
3. **`INCONGRUENT_SARCASTIC` (110 mẫu - 15.7%)**: Đạt mốc 110 mẫu kiểm thử mỉa mai chất lượng cao; phân bố chủ đạo qua `anger` (49 mẫu) và `disgust` (23 mẫu), đồng thời có 20 mẫu `joy` đại diện cho sắc thái tự trào, giễu nhại hài hước.

---

## 5. KẾT LUẬN & ĐÁNH GIÁ ĐỘ SẴN SÀNG

1. **Chuẩn mực khoa học:** Tập dữ liệu 700 mẫu bài đăng mạng xã hội thật đã hoàn thiện xuất sắc:
   - Đáp ứng chuẩn khuyến nghị của GVHD (nằm trong khoảng 500 – 1.000 mẫu, 700 mẫu là quy mô lý tưởng).
   - Đủ 3 loại quan hệ tương tác ngữ nghĩa – cảm xúc.
   - Đủ 7 nhãn cảm xúc Ekman không bị khuyết nhãn nào.
   - Tối giản triệt để chỉ giữ 2 trục trọng tâm, không làm phân tán nhân lực annotator.
2. **Sẵn sàng nghiệm thu:** Toàn bộ 700 mẫu đã đồng bộ vào [`vlm_dataset.json`](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/image-experiment/data/vlm_dataset.json) và [`vlm_dataset_review_huy_le.json`](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/image-experiment/data/vlm_dataset_review_huy_le.json), sẵn sàng phục vụ quy trình thẩm định độc lập và tính toán chỉ số Cohen's Kappa ($\kappa \ge 0.70$) cho Khóa luận Tốt nghiệp.
