---
id: guide-calls-share-emotion
title: Hướng dẫn Cuộc gọi, Chia sẻ Bài viết và Không gian Theo dõi Cảm xúc
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Cuộc gọi Trực tiếp, Lan tỏa Bài viết và Không gian Cảm xúc

Sentimeta tích hợp các công cụ giao tiếp âm thanh/hình ảnh chất lượng cao, chia sẻ nội dung đồng cảm và không gian theo dõi sức khỏe tinh thần dành riêng cho bạn.

## 1. Gọi thoại và Gọi video Trực tiếp (Audio / Video Calls)

Tính năng gọi thoại và video trên Sentimeta được hỗ trợ bởi công nghệ Stream Video mạnh mẽ và ổn định:

- **Thực hiện cuộc gọi:**
  - Truy cập mục **Tin nhắn (`/conversations`)** và mở cuộc trò chuyện với người bạn đã kết bạn.
  - Trên thanh tiêu đề cuộc trò chuyện, bấm biểu tượng **Điện thoại** để bắt đầu cuộc gọi thoại (Audio Call) hoặc biểu tượng **Máy quay** để bắt đầu cuộc gọi video (Video Call).
- **Bộ điều khiển chi tiết trong phòng gọi (`/calls/[callId]`):**
  - **Bật/Tắt Micro:** Nhấp biểu tượng micro (`Mic` / `MicOff`) để tắt tiếng hoặc bật lại âm thanh.
  - **Bật/Tắt Camera:** Nhấp biểu tượng máy quay (`Video` / `VideoOff`) để tắt hoặc mở luồng hình ảnh của bạn.
  - **Chia sẻ màn hình (Screen Sharing):** Trên trình duyệt Web, bạn có thể nhấp vào biểu tượng màn hình (`MonitorUp`) để chia sẻ cửa sổ làm việc, tài liệu học tập hoặc hình ảnh cho người đối diện cùng xem.
  - **Thu nhỏ cửa sổ cuộc gọi (Picture-in-Picture):** Nhấp vào biểu tượng thu nhỏ (`Minimize2`) ở góc trên để thu gọn khung cuộc gọi xuống góc màn hình, cho phép bạn vừa đàm thoại vừa lướt bảng tin hoặc nhắn tin với bạn bè khác. Nhấp `Maximize2` để phóng to lại toàn màn hình.
  - **Kết thúc cuộc gọi:** Bấm nút tròn màu đỏ hình điện thoại gác máy (`PhoneOff`) để rời phòng gọi.
  - **Cấp quyền truy cập thiết bị:** Khi thực hiện cuộc gọi lần đầu, vui lòng cho phép trình duyệt hoặc ứng dụng cấp quyền sử dụng Micro và Máy ảnh (Camera).
  - **Lưu ý về tính năng cảm xúc trong cuộc gọi:** Sentimeta hiện tại **chưa hỗ trợ** tính năng quét biểu cảm khuôn mặt hay nhận diện cảm xúc trực tiếp trong lúc đang gọi điện thoại hoặc gọi video. Cuộc gọi trên Sentimeta tập trung tối ưu vào kết nối đàm thoại và truyền tải hình ảnh/âm thanh ổn định qua nền tảng Stream Video.

---

## 2. Chia sẻ Bài viết và Lan tỏa Cảm xúc (Share)

Dưới mỗi bài viết trên Bảng tin (`/`), trang chi tiết Nhóm (`/groups/[groupId]`) hoặc Trang cá nhân, nút **"Chia sẻ"** cho phép bạn:
- **Chia sẻ lên Trang cá nhân:** Mở hộp thoại `CreateShareModal` đăng lại bài viết lên dòng thời gian của chính bạn. Bạn có thể nhập thêm suy nghĩ, quan điểm cá nhân và lựa chọn phạm vi người xem (Công khai, Bạn bè hoặc Chỉ mình tôi).
- **Gửi qua Tin nhắn:** Chọn người bạn hoặc nhóm chat bạn muốn gửi bài viết đến. Liên kết bài viết sẽ được gửi trực tiếp kèm lời nhắn riêng mà không công khai lên bảng tin.
- **Xem ai đã chia sẻ bài viết:** Nhấp vào số lượt chia sẻ dưới bài viết để xem danh sách những người đã chia sẻ bài viết này.

---

## 3. Không gian Cảm xúc Cá nhân Toàn diện (`/emotions`)

Bấm vào mục **"Cảm xúc" (`/emotions`)** trên thanh điều hướng chính để bước vào không gian chăm sóc sức khỏe tinh thần gồm 5 khu vực giao diện trực quan:

1. **Lời chào & Trạng thái Hôm nay (`EmotionDashboardHeader`):** Lời chào ân cần và tóm tắt trạng thái tâm trạng nổi bật gần nhất của bạn.
2. **Lưới Tóm tắt Cảm xúc (`EmotionSummaryGrid`):** Hiển thị các thẻ chỉ số cảm xúc chủ đạo (Vui vẻ, Bình yên, Buồn bã, Lo âu, Căng thẳng...) giúp bạn có cái nhìn tổng thể về năng lượng tinh thần.
3. **Biểu đồ Xu hướng Tâm trạng (`EmotionTrendCard`):** Vẽ biểu đồ đường theo dõi sự biến thiên tâm trạng qua các ngày trong tuần/tháng, giúp bạn nhận diện thời điểm căng thẳng và chu kỳ cảm xúc cá nhân.
4. **Biểu đồ Phân phối 6 Cảm xúc (`EmotionDistributionCard`):** Biểu đồ thể hiện tỷ lệ phần trăm giữa các cảm xúc tích cực và tiêu cực trong giai đoạn gần nhất.
5. **Thấu hiểu & Lời khuyên từ AI (`EmotionInsightsCard`):** Phân tích xu hướng tâm lý và đưa ra các bài học, lời khuyên thực tế giúp bạn cân bằng cảm xúc.
6. **Dòng thời gian Lịch sử Cảm xúc (`EmotionHistorySection`):** Ghi lại chi tiết từng mốc nhật ký cảm xúc theo thời gian.

**Bài tập Xoa dịu & Thư giãn Tâm trí:**
- **Kỹ thuật chu kỳ thở chủ động (ACBT):** Hít thở sâu và nhịp nhàng giúp giải tỏa căng thẳng tức thì.
- **Thư giãn cơ bắp tiến triển (PMR):** Giãn lỏng từng nhóm cơ trên cơ thể giúp giảm bớt âu lo và mệt mỏi.
- **Thực hành chánh niệm (Mindfulness):** Giúp bạn tập trung vào hiện tại và nuôi dưỡng sự bình an trong tâm hồn.

**Đề xuất Âm nhạc Chữa lành (Music Recommendations):**
- Tích hợp kho bài hát được phân tích cảm xúc qua mô hình AI âm nhạc (MERT).
- Đề xuất danh sách bài hát phù hợp với tâm trạng hiện tại hoặc giai điệu giúp nâng cao năng lượng tích cực khi bạn cảm thấy chán nản.

**Quyền Riêng tư về Cảm xúc:**
- Toàn bộ dữ liệu nhật ký và biểu đồ cảm xúc của bạn là riêng tư, chỉ hiển thị cho chính bạn.
- Bạn có thể bật hoặc tắt quyền AI can thiệp chủ động tại bất kỳ thời điểm nào trong phần **Cài đặt → Quyền riêng tư (`/settings/privacy`)** qua công tắc **"Cho phép AI can thiệp chủ động"**.
