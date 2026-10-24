# Annotation Guidelines — Cẩm Nang Quy Chuẩn Gán Nhãn Đa Phương Thức Text–Image

**Phiên bản:** 2.0 (Cập nhật chuẩn hóa theo chỉ đạo của Giảng viên Hướng dẫn tại Báo cáo Lần 4)  
**Mục đích:** Xây dựng tập dữ liệu kiểm thử chuẩn vàng (**Evaluation Set / Gold Standard**) từ **500 – 1.000 mẫu bài đăng mạng xã hội** phục vụ đo đạc chính xác các chỉ số Precision, Recall và Macro-F1 của hệ thống phân tích cảm xúc đa phương thức.

---

## 1. Mục tiêu và phạm vi

1. **Bối cảnh đề tài:** Đề tài tập trung chuyên sâu vào bài toán **"Nhận diện và phân tích cảm xúc người dùng mạng xã hội"**. Dữ liệu đánh giá gồm các bài đăng thực tế có đầy đủ **văn bản và hình ảnh** (kế thừa từ các bộ benchmark quốc tế chuẩn mực như Twitter MVSA và Memotion 7k, giữ nguyên hình ảnh gốc và dịch tự động văn bản sang tiếng Việt tự nhiên).
2. **Quy mô tập đánh giá:** Ưu tiên làm thật sạch và bảo đảm chất lượng cao cho **500 – 1.000 mẫu** tinh hoa để làm tập Test độc lập, không tiêu tốn nguồn lực tạo tập huấn luyện quá lớn khi không cần thiết.
3. **Phương pháp cốt lõi — Gán nhãn bán tự động (Human-in-the-Loop):**
   - **Bước 1 (VLM Pre-annotation):** Sử dụng các mô hình thị giác-ngôn ngữ lớn hàng đầu (**VLM: Gemini 1.5 Pro / GPT-4o**) để gán nhãn sơ bộ độc lập theo 3 góc độ: **văn bản**, **hình ảnh** và **tổng hợp đa phương thức**, đồng thời phân loại quan hệ tương tác ảnh–chữ và đưa ra lời giải thích ngắn gọn.
   - **Bước 2 (Human Audit & Refinement):** Hai thành viên trong nhóm phân chia kiểm tra, rà soát chuyên sâu và tinh chỉnh lại các mẫu nghi ngờ/mơ hồ nhằm loại bỏ sai lệch và ảo giác (hallucination) của mô hình.
   - **Bước 3 (Đo độ tin cậy khoa học):** Đánh giá tính khách quan bằng chỉ số đồng thuận liên thẩm định viên **Cohen's Kappa ($\kappa \ge 0.70$)** và tiến hành hòa giải các ca bất đồng để tạo tập chuẩn vàng cuối cùng.

---

## 2. Cấu trúc trường nhãn (Bóc tách đa phương thức)

Để phục vụ phân tích học thuật đối đầu (so sánh mô hình đơn phương thức Text-only, Vision-only và mô hình đa phương thức VLM), mỗi mẫu dữ liệu được bóc tách theo các trường nhãn chuẩn hóa:

### 2.1 Ba trường cảm xúc bóc tách (7 nhãn Ekman)
Để đảm bảo tính khoa học và hạn chế tối đa **"Thiên kiến lây lan" (Anchoring / Priming Bias)** khi thẩm định:
1. **`text_only_emotion` (Cảm xúc theo văn bản):** Cảm xúc được truyền tải khi chỉ đọc riêng câu chữ/status.
   - *Kỹ thuật thẩm định chuẩn:* Tự đặt câu hỏi: *"Nếu bạn bè chỉ gửi riêng dòng tin nhắn/status này qua SMS (hoàn toàn không đính kèm hình ảnh), tôi sẽ nhận định đây là cảm xúc gì?"*.
2. **`image_only_emotion` (Cảm xúc theo hình ảnh):** Cảm xúc nổi trội của riêng bức ảnh khi đứng độc lập (không đọc caption/status đi kèm).
   - *Quy tắc đối với Meme có chữ in sẵn (Text-in-image):* Nếu bức ảnh là một meme/chế ảnh có chứa câu thoại hoặc chữ lồng bên trong hình, thẩm định viên **được phép đọc chữ nhúng trong ảnh** để hiểu ngữ cảnh của bức ảnh đó. Riêng trường `text_only_emotion` chỉ xét phần caption/status viết bên ngoài.
3. **`combined_emotion` (Cảm xúc tổng hợp — Trục đánh giá cốt lõi):** Cảm xúc thực tế và nổi trội nhất của **toàn bộ bài đăng** khi người xem tiếp nhận đồng thời cả văn bản và hình ảnh trong bối cảnh mạng xã hội.

### 2.2 Mối quan hệ tương tác Ảnh – Chữ (`relationship_type`)
Phân loại chính xác 1 trong 3 trường hợp theo yêu cầu của GVHD:
- **`CONGRUENT` — Đồng nhất:** Hình ảnh và câu chữ cùng chung một thông điệp và hướng cảm xúc; ảnh minh họa hoặc củng cố trực tiếp ý nghĩa đã rõ ràng trong văn bản. Không cần dựa vào một thông tin quan trọng mới từ ảnh để hiểu thông điệp.
  - *Ví dụ:* Text "Hôm nay nhận được học bổng rồi, vui quá đi!" + ảnh nụ cười rạng rỡ và giấy chứng nhận học bổng $\rightarrow$ Cả hai phương thức cùng mang sắc thái `joy`.
- **`COMPLEMENTARY` — Bổ trợ:** Văn bản hoặc hình ảnh chưa đủ thông tin nếu đứng một mình; phương thức này bổ sung ngữ cảnh, đối tượng hoặc sự kiện quan trọng giúp xác định rõ cảm xúc tổng thể của bài đăng.
  - *Lưu ý quan trọng về khác biệt cảm xúc:* Trường hợp câu chữ và hình ảnh mang sắc thái khác nhau nhưng **không có chủ đích châm biếm hay mỉa mai** (ví dụ: status than thở mệt mỏi nhưng đăng kèm ảnh hoa cỏ/thú cưng để tự an ủi làm dịu tâm trạng), trường hợp này được phân loại vào **`COMPLEMENTARY`** (hình ảnh bổ trợ sắc thái xoa dịu/tích cực cho văn bản), tuyệt đối không gượng ép xếp vào mỉa mai.
  - *Ví dụ:* Text "Cuối cùng cũng hoàn thành sau bao nhiêu nỗ lực!" (trung tính/chung chung) + ảnh ngôi nhà vừa xây xong khang trang $\rightarrow$ Bức ảnh định đoạt bối cảnh tự hào/vui mừng (`joy`).
- **`INCONGRUENT_SARCASTIC` — Mâu thuẫn / Mỉa mai:** Có sự tương phản hoặc nghịch lý có chủ đích giữa câu chữ và hình ảnh nhằm tạo ra sắc thái **mỉa mai, châm biếm, chế giễu hoặc tự trào** (sarcasm / irony / satire).
  - *Ví dụ:* Text "Dịch vụ khách hàng ở đây đúng là tuyệt vời!" + ảnh hàng dài người đứng chờ đợi mệt mỏi trong mưa $\rightarrow$ Text mang nghĩa đen tích cực nhưng toàn bộ bài đăng truyền tải sự bức xúc/tức giận (`anger`).

### 2.3 Các trường kiểm soát chất lượng & giải thích
- **`explanation`:** Lời giải thích ngắn gọn (1–2 câu) của VLM hoặc thẩm định viên về lý do lựa chọn nhãn tổng hợp và mối quan hệ ảnh-chữ.
- **`INSUFFICIENT_CONTEXT` (Cờ chất lượng đặc biệt — Bộ lọc rác kỹ thuật):** Đây là cờ kỹ thuật để loại bỏ dữ liệu hỏng, **TUYỆT ĐỐI KHÔNG phải là nhãn cảm xúc thứ 8 hay loại quan hệ thứ 4**. Cờ này chỉ được kích hoạt khi ảnh bị lỗi hiển thị nghiêm trọng, bản dịch bị hỏng nghĩa hoàn toàn, hoặc cặp text–image hoàn toàn ngẫu nhiên/vô nghĩa do lỗi cào dữ liệu. Các mẫu dính cờ này sẽ bị loại khỏi tập chuẩn trước khi đo đạc chỉ số benchmark.

---

## 3. Quy chuẩn gán nhãn chi tiết

### 3.1 Quy tắc xác định `relationship_type`
Áp dụng theo thứ tự ưu tiên 4 bước:
1. **Kiểm tra tính hợp lệ:** Nếu ảnh hỏng, text rác hoặc hoàn toàn không liên quan $\rightarrow$ Gắn cờ `INSUFFICIENT_CONTEXT` kèm lý do; loại bỏ mẫu khỏi tập benchmark.
2. **Nhận diện Mâu thuẫn / Mỉa mai (`INCONGRUENT_SARCASTIC`):** Tìm kiếm bằng chứng tương phản rõ ràng giữa câu chữ và hình ảnh nhằm mục đích **châm biếm, mỉa mai hoặc tự trào**. Nếu có sự khác biệt cảm xúc nhưng không nhằm châm biếm $\rightarrow$ Chuyển sang bước 3.
3. **Nhận diện Bổ trợ ngữ cảnh (`COMPLEMENTARY`):** Xác định xem nếu thiếu hình ảnh thì văn bản có bị thiếu thông tin cốt lõi hay không (hoặc ngược lại). Nếu một bên làm rõ bối cảnh/đối tượng hoặc bổ sung/điều chỉnh sắc thái cảm xúc cho bên kia, chọn `COMPLEMENTARY`.
4. **Nhận diện Đồng nhất (`CONGRUENT`):** Khi cả hai phương thức cùng truyền tải một ý niệm, cùng chiều cảm xúc hoặc hình ảnh chỉ đơn thuần minh họa cho thông điệp đã hoàn chỉnh của văn bản.

### 3.2 Bảng phân loại 7 nhãn cảm xúc Ekman (`combined_emotion`)

| Nhãn cảm xúc | Hướng dẫn nhận diện | Dấu hiệu đặc trưng trên mạng xã hội |
| :--- | :--- | :--- |
| **`joy`** | Vui vẻ, hạnh phúc, hân hoan, tự hào, hài lòng, biết ơn hoặc hài hước tích cực. | Khoe thành tích, kỷ niệm đẹp, cảnh ăn mừng, meme giải trí vui tươi. |
| **`sadness`** | Buồn bã, cô đơn, thất vọng, tiếc nuối, mất mát hoặc u uất. | Chia tay, thất bại, hoài niệm buồn, tâm trạng cô đơn, thời tiết u ám. |
| **`anger`** | Tức giận, phẫn nộ, bực bội, bất bình trước bất công hoặc sự cố gây bức xúc. | Phàn nàn dịch vụ tệ, tắc đường kẹt xe, tranh cãi xã hội, bức xúc lừa đảo. |
| **`fear`** | Sợ hãi, hoảng hốt, bất an, lo lắng tột độ trước nguy cơ hoặc tai họa. | Dịch bệnh, tin tức rủi ro tài chính/sức khỏe, bóng tối nguy hiểm, tai nạn. |
| **`disgust`** | Ghê tởm, kinh hãi về mặt thể xác hoặc khinh miệt, chê bai mạnh mẽ về mặt đạo đức. | Rác thải bẩn thỉu, hành vi phi đạo đức, sự giả tạo bị bóc trần. |
| **`surprise`** | Ngạc nhiên, ngỡ ngàng, sửng sốt trước tình huống bất ngờ chưa lường trước. | Sự kiện gây sốc, cú twist bất ngờ, khoảnh khắc khó tin chưa rõ vui hay buồn. |
| **`neutral`** | Khách quan, trung tính, không chứa cảm xúc nào nổi trội trong 6 nhóm trên. | Bản tin thời sự thuần túy, thông báo kỹ thuật, bài hướng dẫn, mô tả sự vật. |

**Nguyên tắc cốt lõi khi gán nhãn cảm xúc:**
- **Định vị chủ thể cảm xúc — Poster-centric (Cảm xúc của người đăng bài):**
  - Trọng tâm đề tài là theo dõi trạng thái tâm lý người dùng mạng xã hội. Vì vậy, cảm xúc cần đánh giá là **trạng thái tâm lý mà người đăng muốn bộc lộ qua toàn bộ bài đăng**, tránh suy diễn cảm xúc chủ quan của người xem.
  - *Phân biệt theo tính chất bài đăng (Heuristic tổng quát):*
    + **Chia sẻ tin tức / Tư liệu / Trích dẫn khách quan:** Bài đăng mang phong cách báo chí, trích dẫn danh ngôn, ảnh tư liệu/sự kiện mà người đăng không kèm bình luận cảm xúc cá nhân $\rightarrow$ Ưu tiên chọn **`neutral`** (khách quan, trung tính).
    + **Bài đăng đời thường / Cá nhân / Meme:** Bài đăng thể hiện trải nghiệm sống, ảnh đời thường/selfie, hoặc meme giải trí $\rightarrow$ Đánh giá cảm xúc thực tế toát ra từ bài đăng (**`joy`**, **`sadness`**, **`anger`**...).
- **Hiện tượng Mỉa mai / Tự trào / Giễu cợt:** Căn cứ vào cảm xúc ngầm ẩn thực tế của bài đăng (ví dụ: tự trào, cà khịa hài hước $\rightarrow$ `joy`; bức xúc châm biếm sâu cay $\rightarrow$ `anger` hoặc `disgust`).
- **Nguyên tắc nhãn trung tính (`neutral`):** Áp dụng cho các nội dung thông báo thuần túy, mô tả sự vật khách quan, hoặc khi không có cảm xúc nào đủ rõ nét.

---

## 4. Quy trình Gán nhãn Bán tự động (Human-in-the-Loop Workflow)

Quy trình gán nhãn bán tự động được thiết kế chặt chẽ theo 5 giai đoạn nhằm tối ưu hóa thời gian nhưng vẫn đảm bảo tính chuẩn xác và khách quan tuyệt đối:

### 4.1 Giai đoạn 1: Gán nhãn sơ bộ bằng VLM (Gemini 1.5 Pro / GPT-4o)
- **Mô hình triển khai:** Sử dụng **Gemini 1.5 Pro** hoặc **GPT-4o** thông qua API để tận dụng năng lực phân tích thị giác-ngôn ngữ mạnh mẽ.
- **Phương thức thực hiện:**
  - Cung cấp đồng thời văn bản gốc tiếng Anh, bản dịch tiếng Việt tự nhiên và tệp hình ảnh gốc.
  - Sử dụng prompt chuẩn hóa với cơ chế JSON Mode nghiêm ngặt.
  - VLM phân tích và xuất nhãn sơ bộ gồm 4 trường cốt lõi:
    + Cảm xúc riêng theo văn bản (`text_only_emotion`).
    + Cảm xúc riêng theo hình ảnh (`image_only_emotion`).
    + Cảm xúc tổng hợp toàn bài đăng (`combined_emotion`).
    + Mối quan hệ tương tác giữa văn bản và hình ảnh (`relationship_type`).
    + Lời giải thích cơ sở phân tích (`explanation`).
- **Lưu ý nguyên tắc:** Kết quả do VLM sinh ra **chỉ là đề xuất ban đầu (proposals)**, không mặc nhiên được coi là Ground Truth.

### 4.2 Giai đoạn 2: Định nghĩa và Nhận diện các "Mẫu Nghi Ngờ / Mơ Hồ"
Hệ thống và nhóm gán nhãn chủ động xác định các nhóm mẫu có nguy cơ sai lệch cao để đưa vào danh sách kiểm tra trọng điểm:
1. **Mâu thuẫn giữa các phương thức (Modality Divergence):**
   - Khi `text_only_emotion` lệch hoàn toàn so với `image_only_emotion` (ví dụ: Text là `joy` nhưng Image là `sadness` hoặc `disgust`).
   - Đây là khu vực tiềm ẩn hiện tượng mỉa mai, châm biếm, nơi VLM dễ bị "lừa" bởi nghĩa đen bề mặt của từ ngữ.
2. **Quan hệ không đồng nhất (`INCONGRUENT_SARCASTIC` & `COMPLEMENTARY`):**
   - Toàn bộ các mẫu được VLM dự đoán thuộc 2 nhóm quan hệ này đều được đưa vào diện rà soát kỹ lưỡng, do bản chất đa nghĩa và phụ thuộc sâu vào ngữ cảnh văn hóa mạng xã hội.
3. **Mẫu có độ tự tin biên hoặc lời giải thích lỏng lẻo:**
   - Khi lời giải thích của VLM thể hiện sự do dự, chứa các cụm từ phân vân (như "tuy nhiên", "có thể hiểu theo hai hướng", "khó phân định") hoặc không ăn khớp với nhãn cảm xúc đã chọn.
4. **Mẫu chứa hình ảnh phức tạp hoặc văn hóa mạng đặc thù:**
   - Hình ảnh chứa nhiều chữ nhúng (text-in-image / typography meme), tiếng lóng (slang), hoặc các yếu tố văn hóa phương Tây có nguy cơ bị biến dạng sắc thái khi dịch máy.
5. **Nghi vấn về chất lượng dữ liệu:**
   - Văn bản quá ngắn ($< 5$ từ), câu cảm thán cụt lủn, hoặc hình ảnh mờ khiến việc phân định cảm xúc trở nên mơ hồ.

### 4.3 Giai đoạn 3: Phân chia thẩm định & Tinh chỉnh của 2 bạn (Human Review & Refinement)
Hai thành viên (Annotator 1 và Annotator 2) tiến hành rà soát và tinh chỉnh theo quy chế:
- **Công cụ thẩm định:** Sử dụng giao diện web trực quan [`human_review_ui.html`](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/image-experiment/human_review_ui.html) kết hợp máy chủ cục bộ [`review_server.py`](file:///D:/VsCode/NestJS/projects/SE121-microservices/evaluation/image-experiment/review_server.py). Giao diện hiển thị trực quan ảnh gốc (hỗ trợ zoom/lightbox), văn bản song ngữ, bảng đối chiếu với đề xuất của VLM và ô ghi chú phản biện.
- **Thẩm định mù độc lập (Double-Blind Review):**
  - Hai bạn gán nhãn độc lập trên cùng phiên bản dữ liệu; **tuyệt đối không trao đổi hoặc xem nhãn của nhau** trong suốt vòng thẩm định đầu tiên để bảo đảm tính khách quan khoa học.
- **Cơ chế phân chia công việc rà soát & tinh chỉnh:**
  - *Tập chung đối chứng (Overlap Set):* Cả hai bạn cùng thẩm định độc lập trên tập mẫu kiểm thử (hoặc tập pilot) để làm cơ sở tính toán chỉ số Cohen's Kappa.
  - *Rà soát chuyên sâu các mẫu nghi ngờ/mơ hồ:* Hai bạn tập trung kiểm tra kỹ các mẫu thuộc danh sách nghi ngờ/mơ hồ đã được lọc ở Giai đoạn 2. Đối chiếu trực tiếp với nguyên văn tiếng Anh nếu phát hiện bản dịch tiếng Việt làm sai lệch sắc thái biểu cảm.
  - *Quyền tinh chỉnh của con người:* Thẩm định viên hoàn toàn chủ động ghi đè (override) nhãn nếu phát hiện đề xuất của VLM không hợp lý. Bắt buộc ghi chú ngắn gọn lý do điều chỉnh vào trường `reviewNotes` đối với các ca khó hoặc khi quyết định thay đổi nhãn.

### 4.4 Giai đoạn 4: Đo độ tin cậy liên thẩm định viên (Cohen's Kappa)
- Sau khi cả 2 bạn hoàn thành việc thẩm định độc lập, chạy script tính toán độ đồng thuận:
  ```powershell
  python evaluation/image-experiment/prepare_multimodal_dataset.py --mode compute-kappa
  ```
- **Chỉ số kiểm định:** Tính toán chỉ số **Cohen's Kappa ($\kappa$)** riêng biệt cho từng trường:
  - $\kappa_{\text{emotion}}$ trên 7 lớp cảm xúc (`combined_emotion`).
  - $\kappa_{\text{relation}}$ trên 3 lớp quan hệ (`relationship_type`).
- **Ngưỡng chấp thuận khoa học:** Theo đúng chỉ đạo của GVHD, chỉ số đồng thuận giữa hai bạn phải đạt **$\kappa \ge 0.70$** (Mức độ đồng thuận đáng kể - Substantial Agreement theo chuẩn Landis & Koch). Nếu $\kappa < 0.70$, hai bạn phải rà soát lại các bất đồng, làm rõ các trường hợp biên trong guideline và thực hiện vòng thẩm định lại.

### 4.5 Giai đoạn 5: Hòa giải bất đồng & Đóng gói tập Evaluation Set
1. Hệ thống tự động trích xuất danh sách các mẫu có sự bất đồng ý kiến giữa hai bạn (thường chiếm khoảng 5% – 10% tổng số mẫu).
2. **Phiên họp hòa giải (Adjudication Session):** Hai bạn cùng ngồi lại, đối chiếu từng mẫu bất đồng với các định nghĩa và ví dụ trong Guideline này để đi đến sự thống nhất về nhãn tham chiếu duy nhất.
3. Nếu gặp ca đặc biệt phức tạp không thể thống nhất, ghi nhận trường hợp biên và tham vấn ý kiến GVHD hoặc chuyên gia thứ ba; nếu mẫu thực sự không thể kết luận được, đánh dấu loại khỏi tập chuẩn.
4. Xuất bản tệp dữ liệu chuẩn vàng (**Gold Standard Evaluation Set**) sẵn sàng cho benchmark đối đầu giữa các mô hình AI/VLM.

---

## 5. Thử nghiệm Pilot (Thẩm định thử nghiệm 30 – 50 mẫu)

Trước khi tiến hành trên toàn bộ tập dữ liệu, hai bạn bắt buộc phải thực hiện bước Pilot:
1. Lấy ngẫu nhiên **30 – 50 mẫu** bao gồm đầy đủ các trường hợp: bài đăng thông thường, meme châm biếm, bài đăng trung tính và các ca đa nghĩa khó.
2. Hai bạn gán nhãn độc lập dựa trên đề xuất sơ bộ của VLM.
3. Đo chỉ số Cohen's Kappa sơ bộ và thảo luận ngay về các điểm chưa hiểu thống nhất trong Guideline.
4. Hiệu chỉnh, bổ sung các ví dụ biên vào Guideline trước khi bước vào giai đoạn gán nhãn chính thức.

---

## 6. Tiêu chí loại bỏ mẫu không hợp lệ (`INSUFFICIENT_CONTEXT`)

Mẫu chỉ bị loại khỏi tập đánh giá khi vi phạm ít nhất một trong các tiêu chí kỹ thuật sau:
- Tệp hình ảnh bị hỏng không thể mở, bị lỗi mã hóa hoặc độ phân giải quá thấp ($< 100 \times 100$ pixel) không thể nhận diện được chủ thể.
- Văn bản hoàn toàn là ký tự rác, chuỗi ngẫu nhiên không có nghĩa, hoặc chỉ chứa một URL/tag mà không có nội dung ngữ nghĩa.
- Cặp hình ảnh và văn bản hoàn toàn không có bất kỳ mối liên hệ ngữ cảnh nào (ví dụ: ảnh quảng cáo bán giày ghép ngẫu nhiên với status chia buồn đám tang do lỗi thu thập dữ liệu).

> [!CAUTION]
> Tuyệt đối không gắn cờ `INSUFFICIENT_CONTEXT` hoặc loại bỏ mẫu chỉ vì bài đăng mang tính trung tính khó phân loại, hoặc vì hai bạn chưa đạt được sự đồng thuận về nhãn cảm xúc.

---

## 7. Bảng kiểm tra dành cho thẩm định viên (Reviewer Checklist)

Trước khi nhấn nút lưu phán quyết cho mỗi mẫu, thẩm định viên tự kiểm tra:
- [ ] **Xem xét toàn diện:** Đã quan sát kỹ cả hình ảnh gốc và đọc kỹ văn bản gốc (đối chiếu bản dịch tiếng Việt).
- [ ] **Bóc tách khách quan (Chống thiên kiến lây lan):** 
  - Đã tự hỏi: *"Nếu chỉ đọc SMS không có ảnh, cảm xúc câu chữ là gì?"* để chọn `text_only_emotion`.
  - Đã tự hỏi: *"Nếu chỉ nhìn lướt ảnh này không có status, cảm xúc ảnh là gì?"* (cho phép đọc chữ in trong meme) để chọn `image_only_emotion`.
- [ ] **Không thiên lệch VLM:** Chỉ xem nhãn VLM (Gemini 1.5 Pro / GPT-4o) là gợi ý ban đầu; luôn căn cứ vào nhận thức khách quan của con người trong ngữ cảnh mạng xã hội.
- [ ] **Phân biệt đúng quan hệ ảnh-chữ:** 
  - Củng cố thông điệp đã rõ ràng: `CONGRUENT`.
  - Khác biệt cảm xúc mang tính xoa dịu/bổ sung bối cảnh: `COMPLEMENTARY`.
  - Có bằng chứng rõ ràng về châm biếm, mỉa mai, cà khịa hoặc tự trào: `INCONGRUENT_SARCASTIC`.
- [ ] **Xử lý mẫu nghi ngờ/mơ hồ:** Đã rà soát kỹ lưỡng các mẫu bị lệch cảm xúc giữa ảnh và chữ hoặc VLM có độ tự tin thấp; ghi chú lý do nếu điều chỉnh nhãn.
- [ ] **Độc lập tuyệt đối:** Đã hoàn thành và lưu kết quả thẩm định cá nhân trước khi bước vào phiên họp hòa giải.
