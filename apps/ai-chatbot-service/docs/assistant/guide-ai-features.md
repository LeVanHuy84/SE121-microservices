---
id: guide-ai-features
title: Hướng dẫn Các Tính năng Trí tuệ Nhân tạo (AI) trên Sentimeta
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Những Người Bạn AI Đồng Hành Cùng Bạn trên Sentimeta

Sentimeta kết hợp Trí tuệ Nhân tạo (AI) với tâm lý học tích cực để mang đến cho bạn một người bạn đồng hành thấu hiểu, một người dẫn đường thông minh và một không gian mạng xã hội an toàn.

## 1. Trợ lý AI Sentimeta (Sentimeta Assistant)

Trợ lý AI là người bạn tâm giao luôn túc trực lắng nghe bạn bất kể ngày đêm:

- **Vị trí trên giao diện:**
  - Nhấp vào **biểu tượng Trợ lý AI (bong bóng chat màu tím)** ở góc dưới bên phải màn hình.
  - Khung trượt **Assistant Sheet** (trên Web) hoặc Modal trò chuyện (trên Mobile) sẽ xuất hiện tiện lợi ngay cạnh màn hình bạn đang xem.

- **Các năng lực tương tác thông minh trên giao diện hiện tại:**
  - **Tâm sự & Lắng nghe Thấu cảm:**
    - Bạn có thể trút bỏ những áp lực, phiền muộn mà không lo bị phán xét. Trợ lý AI được xây dựng theo phương pháp trò chuyện gợi mở (Socratic Questioning), hỗ trợ bạn gọi tên cảm xúc và tìm lại sự bình tĩnh.
  - **Hướng dẫn Bài tập Thư giãn Tức thì:**
    - Khi bạn căng thẳng hoặc lo âu, Trợ lý sẽ từng bước hướng dẫn bạn Kỹ thuật chu kỳ thở chủ động (ACBT) hoặc Thư giãn cơ bắp tiến triển (PMR).
  - **Nút Điều hướng Thông minh (Smart Navigation Buttons):**
    - Thay vì chỉ hướng dẫn bằng chữ, Trợ lý AI sẽ đính kèm trực tiếp các **nút điều hướng** ngay dưới câu trả lời (`[Đến trang Bạn bè]`, `[Xem Lời mời kết bạn]`, `[Khám phá nhóm]`, `[Cài đặt quyền riêng tư]`, `[Lịch sử kiểm duyệt]`, `[Không gian Cảm xúc]`, v.v.). Bạn chỉ cần nhấp một chạm để đến ngay màn hình mong muốn.
  - **Thẻ Thông tin & Tương tác Trực quan (Interactive Mini Cards):**
    - Trợ lý có thể nhúng các thẻ dữ liệu thu nhỏ trực quan ngay trong cuộc trò chuyện: Thẻ tóm tắt cảm xúc 7 ngày qua (`EmotionSummaryCard`), Thẻ gợi ý bài hát (`MusicCard`), Thẻ gợi ý/lời mời kết bạn (`FriendRequestsCard`), Thẻ gợi ý nhóm (`GroupCard`), hoặc Thẻ xem thông báo mới (`NotificationCard`).
    - Với các thao tác tương tác nhanh không gây mất dữ liệu (như **Kết bạn**, **Chấp nhận lời mời**, **Tham gia nhóm**), bạn có thể bấm nút thao tác trực tiếp ngay trên thẻ. Với các thao tác nhạy cảm (như **Hủy kết bạn**, **Rời nhóm**, **Chặn người dùng**), thẻ chỉ hiển thị ở chế độ xem nhanh kèm liên kết mở đúng trang để bạn tự kiểm tra và thực hiện an toàn.
  - **Thực thi Hành động Toàn cục An toàn có Xác nhận (Action Confirmation Cards):**
    - Với thao tác toàn cục rõ ràng như *"Đánh dấu đã đọc tất cả thông báo"*, Trợ lý sẽ hiển thị **Thẻ xác nhận hành động** với 2 nút rõ ràng: **`[Xác nhận]`** và **`[Hủy]`**. Hệ thống không bao giờ tự ý thay đổi dữ liệu ngầm khi chưa có sự xác nhận của bạn.
  - **Tùy chỉnh Quyền riêng tư Trợ lý AI (`FULL` / `RESTRICTED`):**
    - Tại **Cài đặt → Quyền riêng tư (`/settings/privacy`)**, bạn có thể chọn chế độ **Đầy đủ tính năng (`FULL`)** để Trợ lý AI tra cứu dữ liệu cá nhân, hiển thị thẻ tương tác và đề xuất thao tác, hoặc chế độ **Riêng tư tối đa (`RESTRICTED`)** để AI chỉ hỗ trợ tâm lý, giải đáp hướng dẫn và cung cấp nút điều hướng mà không đọc dữ liệu cá nhân của bạn.

## 2. AI Lắng nghe Cảm xúc Bài viết & Đề xuất Âm nhạc

- **Ghi nhận cảm xúc tự động:**
  - Mỗi khi bạn đăng một dòng tâm trạng hoặc bài viết, mô hình AI cảm xúc nhẹ nhàng nhận diện sắc thái cảm xúc (Vui vẻ, Bình yên, Buồn bã, Lo âu, Căng thẳng...) để cập nhật biểu đồ tại **Không gian Cảm xúc (`/emotions`)**.
  - Việc nhận diện này diễn ra tự động và hoàn toàn riêng tư, chỉ hiển thị cho chính bạn.
- **Đề xuất Âm nhạc Chữa lành (Music Recommendation with MERT):**
  - Hệ thống sử dụng mô hình học sâu **MERT (Music Emotion Recognition Transformer)** để phân tích đặc trưng âm nhạc theo hai trục không gian cảm xúc: **Valence** (mức độ tích cực, tươi sáng của giai điệu) và **Arousal** (mức độ kích hoạt năng lượng, êm dịu hay sôi động).
  - **Lợi ích cốt lõi của tính năng gợi ý nhạc:**
    1. **Điều hòa cảm xúc (Emotion Regulation):** Áp dụng nguyên tắc trị liệu Iso-principle — hệ thống bắt đầu bằng những bài hát đồng cảm với tâm trạng hiện tại của bạn (giúp bạn cảm thấy được thấu hiểu), sau đó chuyển tiếp dần sang các bài hát tươi sáng hơn để nâng đỡ tinh thần tự nhiên.
    2. **Xua tan căng thẳng và hỗ trợ giấc ngủ:** Gợi ý những giai điệu êm dịu, tiết tấu chậm giúp làm dịu hệ thần kinh giao cảm khi bạn bị lo âu hoặc khó ngủ.
    3. **Tái tạo năng lượng và tăng tập trung:** Gợi ý danh sách nhạc kích thích sự hứng khởi khi bạn cần học tập, làm việc hoặc vượt qua sự uể oải.
  - Bạn có thể nghe trực tiếp các gợi ý này tại **Không gian Cảm xúc (`/emotions`)** hoặc nhận thẻ gợi ý bài hát (`MusicCard`) khi trò chuyện cùng Trợ lý AI.
- **Tùy chỉnh Can thiệp Chủ động:**
  - Nếu AI nhận thấy bạn có dấu hiệu căng thẳng kéo dài, hệ thống có thể gửi thông báo hỏi thăm hoặc hiển thị đề xuất bài tập xoa dịu.
  - Bạn có toàn quyền bật hoặc tắt tính năng này trong phần **Cài đặt → Quyền riêng tư (`/settings/privacy`)** qua mục **"Cho phép AI can thiệp chủ động"**.

## 3. AI Bảo vệ Cộng đồng & Kiểm duyệt Nội dung

Để Sentimeta luôn là một không gian văn minh và lành mạnh:
- **Kiểm duyệt tự động:** Mô hình xử lý ngôn ngữ tự nhiên kiểm tra văn bản và hình ảnh để kịp thời ngăn chặn các nội dung kích động bạo lực, ngôn từ thù ghét, quấy rối hoặc nội dung độc hại.
- **Minh bạch và Khiếu nại:** Nếu bài viết của bạn vô tình bị nhận diện nhầm và bị tạm ẩn, bạn hoàn toàn có thể vào **Cài đặt → Lịch sử kiểm duyệt (`/settings/moderation-history`)** để xem lý do và bấm nút **"Gửi khiếu nại" (Appeal)** để đội ngũ hỗ trợ xem xét lại.

## 4. Hỗ trợ Khẩn cấp & Đường dây nóng Tâm lý Sentimeta Liên kết

Khi bạn hoặc người thân đang trải qua giai đoạn khủng hoảng tâm lý nghiêm trọng, bế tắc hoặc có ý nghĩ tự hại, hãy nhớ rằng bạn luôn có sự trợ giúp kịp thời:
- Sentimeta liên kết và khuyến nghị 3 đường dây nóng khẩn cấp hoạt động 24/7 hoàn toàn miễn phí:
  - **1900 599 830** (Đường dây nóng Ngày Mai): Hỗ trợ chuyên sâu về khủng hoảng tâm lý, trầm cảm và ngăn ngừa tự tử từ các chuyên gia tâm lý học.
  - **111** (Tổng đài Quốc gia Bảo vệ Trẻ em): Tư vấn tâm lý, bảo vệ trẻ em và thanh thiếu niên khỏi bạo lực gia đình và xâm hại 24/7.
  - **115** (Cấp cứu Y tế Khẩn cấp): Can thiệp và cấp cứu y tế tức thời khi có nguy cơ tổn thương thể chất hoặc ngộ độc thuốc.

> Bạn luôn xứng đáng được lắng nghe, thấu cảm và bảo vệ. Sentimeta luôn ở đây bên bạn!
