---
id: guide-post
title: Hướng dẫn Đăng bài, Tương tác và Quản lý Nội dung
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Chia sẻ Cảm xúc và Tương tác Cộng đồng

Sentimeta khuyến khích bạn chia sẻ chân thành những suy nghĩ, cảm xúc và khoảnh khắc trong cuộc sống. Dưới đây là hướng dẫn chi tiết các thao tác đăng bài và tương tác trên giao diện ứng dụng.

## 1. Viết bài và Đăng tải Nội dung

**Tạo bài viết mới:**
- Bạn có thể tạo bài viết từ khung soạn thảo ở đầu Bảng tin Trang chủ (`/`) hoặc trong trang chi tiết Nhóm (`/groups/[groupId]`).
- Nhấp vào ô **"Bạn đang nghĩ gì?"** để mở hộp thoại tạo bài viết:
  - **Nội dung văn bản:** Nhập những chia sẻ, câu chuyện hoặc tâm sự của bạn.
  - **Tải ảnh lên:** Bấm biểu tượng hình ảnh để đính kèm một hoặc nhiều bức ảnh từ thiết bị.
  - **Gắn thẻ cảm xúc/tâm trạng:** Chọn trạng thái tâm trạng phù hợp (Vui vẻ, Bình yên, Trăn trở, Buồn bã...) để làm phong phú nội dung.
  - **Chọn quyền riêng tư (Audience):** Nhấp vào nút phạm vi hiển thị để chọn:
    - **Công khai (Public):** Mọi thành viên trên Sentimeta đều có thể đọc bài viết.
    - **Bạn bè (Friends):** Chỉ những người trong danh sách bạn bè mới thấy bài viết.
    - **Chỉ mình tôi (Only Me):** Bài viết ở chế độ riêng tư, lưu giữ cho riêng bạn.
  - Bấm nút **"Đăng"** để hoàn tất chia sẻ.

---

## 2. Thả Cảm xúc (Reactions)

Dưới mỗi bài viết hoặc bình luận, bạn có thể bày tỏ cảm xúc bằng hệ thống 6 biểu tượng tương tác:
- **Thích (Like)** 👍: Bày tỏ sự ủng hộ và ghi nhận.
- **Yêu thích (Love)** ❤️: Lan tỏa sự yêu thương, ấm áp.
- **Haha** 😂: Chia sẻ tiếng cười và sự hài hước.
- **Wow** 😮: Thể hiện sự ngạc nhiên, trầm trồ.
- **Buồn (Sad)** 😢: Bày tỏ sự đồng cảm và thấu hiểu nỗi buồn.
- **Phẫn nộ (Angry)** 😡: Thể hiện sự bức xúc trước các vấn đề tiêu cực.

*Cách thả cảm xúc:* Rê chuột vào nút Thích (trên máy tính) hoặc nhấn giữ nút Thích (trên điện thoại) để thanh biểu tượng cảm xúc xuất hiện, sau đó nhấp chọn cảm xúc bạn muốn. Để hủy cảm xúc, bấm lại vào biểu tượng cảm xúc đã chọn.

---

## 3. Bình luận và Phản hồi (Comments & Replies)

- Bấm nút **"Bình luận"** dưới bài viết để mở khung bình luận.
- Bạn có thể nhập nhận xét của mình, gửi bình luận và đọc các chia sẻ của thành viên khác.
- Bấm nút **"Phản hồi"** dưới một bình luận cụ thể để trò chuyện trực tiếp theo chuỗi thảo luận.
- Bạn cũng có thể thả biểu tượng cảm xúc (Like, Love, Haha, Wow, Sad, Angry) trực tiếp cho từng bình luận.

---

## 4. Chia sẻ Bài viết (Share)

Bấm nút **"Chia sẻ"** ở góc dưới bên phải mỗi bài viết để chọn hình thức lan tỏa:
- **Chia sẻ lên Trang cá nhân:** Đăng lại bài viết lên dòng thời gian của bạn kèm theo lời bình luận hoặc cảm xúc cá nhân.
- **Gửi qua Tin nhắn:** Mở danh sách bạn bè hoặc cuộc hội thoại gần đây để gửi liên kết bài viết trực tiếp cho người bạn muốn tâm sự.

---

## 5. Quản lý Bài viết Cá nhân & Lịch sử Chỉnh sửa

Đối với bài viết của chính bạn: Bấm vào biểu tượng dấu 3 chấm (`...`) ở góc trên bên phải bài viết để mở menu tùy chọn:
- **Chỉnh sửa bài viết:** Sửa đổi nội dung văn bản bài đăng hoặc thay đổi hình ảnh.
- **Xem Lịch sử chỉnh sửa bài viết (Edit Histories):** Bên cạnh thời gian đăng bài viết (ví dụ: "vừa xong", "1 giờ trước"), nếu bài đã từng được sửa, hệ thống sẽ hiển thị nhãn **"Đã chỉnh sửa"**. Nhấp vào nhãn này để mở hộp thoại xem lại các phiên bản nội dung trước đó của bài viết (`GET /posts/:postId/edit-histories`).
- **Chỉnh sửa quyền riêng tư:** Chuyển đổi giữa chế độ Công khai, Bạn bè hoặc Chỉ mình tôi bất cứ lúc nào.
- **Xóa bài viết:** Gỡ bỏ bài viết vĩnh viễn khỏi dòng thời gian và cơ sở dữ liệu.

---

## 6. Kiểm duyệt Tự động và Gửi Khiếu nại (Moderation & Appeals)

- Để bảo đảm môi trường cộng đồng văn minh, hệ thống kiểm duyệt tự động sử dụng AI để phát hiện ngôn từ thù ghét, độc hại hoặc hình ảnh không phù hợp.
- **Khi bài viết bị tạm ẩn hoặc gắn cờ:** Bạn sẽ nhận được thông báo giải thích trạng thái bài đăng.
- **Xem chi tiết và gửi khiếu nại:** Truy cập vào **Cài đặt → Lịch sử kiểm duyệt (`/settings/moderation-history`)** để xem danh sách bài viết bị cảnh báo, lý do gắn cờ và bấm nút **"Gửi khiếu nại" (Appeal)** nếu bạn nhận thấy hệ thống đã nhận diện nhầm. Đội ngũ kiểm duyệt sẽ xem xét lại nội dung của bạn.

---

## 7. Báo cáo Bài viết Xấu (Report)

Nếu bạn gặp bài viết hoặc bình luận vi phạm tiêu chuẩn cộng đồng, quấy rối hoặc gây tổn thương:
- Bấm vào biểu tượng dấu 3 chấm (`...`) trên bài viết hoặc bình luận đó.
- Chọn **"Báo cáo" (Report)**.
- Chọn lý do vi phạm (Spam, Ngôn từ thù ghét, Bạo lực, Nội dung không an toàn...) và gửi báo cáo để ban quản trị xử lý kịp thời.

---

## 8. Câu hỏi thường gặp & Giới hạn tính năng Bài viết (FAQ)

- **Sentimeta có tính năng Tin ngắn 24h (Story) biến mất sau 1 ngày không?**
  - Không. Sentimeta hiện **chưa hỗ trợ tính năng Story 24h**. Ứng dụng tập trung vào bài viết cảm xúc và nhật ký tâm trạng dài lâu.
- **Sentimeta có hỗ trợ Livestream phát trực tiếp video trên Bảng tin không?**
  - Không. Sentimeta hiện **chưa hỗ trợ tính năng Livestream công khai**. Ứng dụng chỉ hỗ trợ Cuộc gọi thoại và Cuộc gọi video trực tiếp 1-1 hoặc trong nhóm chat qua nền tảng Stream Video.

---

## 9. Mục đích AI Quét và Phân tích Cảm xúc Bài đăng

Khi bạn đăng tải một bài viết hoặc dòng tâm trạng, mô hình AI ngôn ngữ (PhoBERT) sẽ tự động phân tích sắc thái cảm xúc ẩn sau câu chữ nhằm 4 mục đích bảo vệ và hỗ trợ người dùng:
1. **Theo dõi dòng thời gian tâm trạng cá nhân (EMA):** Tự động tổng hợp và vẽ biểu đồ diễn biến cảm xúc tại Không gian Cảm xúc (`/emotions`), giúp bạn tự quan sát và thấu hiểu sức khỏe tinh thần của chính mình trong không gian riêng tư tuyệt đối.
2. **Kích hoạt Bảng tin Không gian An toàn (Safe Space Feed):** Khi AI nhận thấy bạn đang có dấu hiệu mệt mỏi, buồn bã hoặc căng thẳng kéo dài, thuật toán phân phối bảng tin sẽ tự động ưu tiên các bài viết tích cực, ấm áp, câu chuyện chữa lành từ bạn bè và nhóm, đồng thời hạn chế các nội dung gay gắt hoặc gây thêm áp lực.
3. **Đề xuất Âm nhạc Chữa lành (Music Recommendation):** Gợi ý những giai điệu xoa dịu hoặc nâng đỡ tâm trạng từ kho nhạc được phân tích theo mô hình MERT.
4. **Cảnh báo và Hỗ trợ Khẩn cấp:** Phát hiện sớm các tín hiệu trầm cảm nặng hoặc nguy cơ tự hại để kịp thời gửi thông báo hỏi thăm và cung cấp thông tin đường dây nóng hỗ trợ tâm lý chuyên môn:
   - **1900 599 830** (Đường dây nóng Ngày Mai)
   - **111** (Tổng đài Quốc gia Bảo vệ Trẻ em & Tham vấn Tâm lý)
   - **115** (Cấp cứu y tế khẩn cấp)
