---
id: guide-general
title: Giới thiệu chung và Hướng dẫn Giao diện Sentimeta
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Xin chào, đây là Sentimeta!

Sentimeta không chỉ là nơi để kết nối — mà là một không gian an toàn, nơi bạn có thể chậm lại, lắng nghe bản thân và tìm kiếm sự đồng cảm. Mọi tính năng của ứng dụng đều được xây dựng với một cốt lõi duy nhất: tôn trọng bạn và bảo vệ sức khỏe tinh thần của bạn.

## 1. Bản đồ Giao diện và Điều hướng Hệ thống

Sentimeta được thiết kế trực quan và nhất quán trên cả nền tảng Web và Di động:

- **Thanh điều hướng chính (Header / Sidebar):**
  - **Trang chủ (`/`):** Bảng tin bài viết cập nhật liên tục từ bạn bè và các cộng đồng nhóm bạn tham gia.
  - **Bạn bè (`/friends`):** Danh sách bạn bè hiện tại, Lời mời kết bạn (`/friends/requests`), Gợi ý bạn bè (`/friends/suggestions`) và Danh sách người dùng đã chặn (`/friends/blocked`).
  - **Nhóm (`/groups`):** Khám phá nhóm mới (`/groups/explore`), Nhóm bạn tham gia hoặc quản lý (`/groups/my-groups`) và Lời mời tham gia nhóm (`/groups/invites`).
  - **Tin nhắn (`/conversations`):** Hộp thư trò chuyện cá nhân 1-1, chat nhóm và các cuộc gọi thoại / video trực tiếp.
  - **Cảm xúc (`/emotions`):** Không gian cảm xúc cá nhân, biểu đồ diễn biến tâm trạng (EMA), bài tập thư giãn và danh sách nhạc chữa lành.
  - **Thông báo (`/notifications`):** Biểu tượng chuông trên thanh điều hướng hiển thị các cập nhật tương tác, lời mời kết bạn và cảnh báo hệ thống.
  - **Tìm kiếm (`/search`):** Thanh tìm kiếm trên đầu trang giúp bạn tra cứu bài viết, người dùng hoặc nhóm theo từ khóa.

- **Menu Người dùng & Trang cá nhân (`/profile/[id]`):**
  - Bấm vào ảnh đại diện (avatar) ở góc trên thanh điều hướng để mở menu tài khoản.
  - Chọn **Trang cá nhân** để xem hồ sơ của bạn, danh sách bài viết cá nhân, tab bạn bè và media. Bấm nút **"Chỉnh sửa trang cá nhân"** để đổi tên hiển thị, ảnh đại diện, ảnh bìa và lời giới thiệu (bio).
  - Chọn **Cài đặt (`/settings`)** để tùy chỉnh tài khoản, quyền riêng tư, thông báo, nhật ký hoạt động và lịch sử kiểm duyệt.

- **Trợ lý AI Sentimeta (Chatbot Assistant):**
  - Nút tròn mở Trợ lý AI nằm ở góc dưới bên phải màn hình.
  - Khi bấm vào, giao diện sẽ mở ra khung trượt **Assistant Sheet** (trên Web) hoặc Modal trò chuyện (trên Mobile).
  - Trợ lý AI hỗ trợ tâm sự, giải đáp thắc mắc, cung cấp nút điều hướng nhanh đến các trang (`Navigate Actions`), hiển thị thẻ tóm tắt trực quan (`Mini Cards`) và hỗ trợ thực thi thao tác an toàn có xác nhận (`Confirmation Cards`).

## 2. Quyền Riêng tư & Bảo mật Dữ liệu

Sự an toàn và an tâm của bạn là ưu tiên hàng đầu tại Sentimeta:

- Tin nhắn cá nhân của bạn chỉ hiển thị cho những người tham gia cuộc trò chuyện trong ứng dụng. Lưu ý: Sentimeta **hiện chưa hỗ trợ mã hóa đầu cuối**, vì vậy trong một số trường hợp cần thiết để vận hành, bảo trì hệ thống hoặc xử lý vi phạm, đội ngũ kỹ thuật có thể truy cập được nội dung. Hãy tránh chia sẻ mật khẩu hay thông tin quá nhạy cảm qua tin nhắn.
- Dữ liệu cảm xúc, bài viết và hoạt động của bạn được bảo mật theo nguyên tắc tối thiểu. Bạn có toàn quyền thiết lập phạm vi hiển thị bài viết và tin nhắn trong phần **Cài đặt → Quyền riêng tư (`/settings/privacy`)**.
- Sentimeta cam kết không bán hoặc chia sẻ dữ liệu cá nhân hay dữ liệu cảm xúc của bạn cho bên thứ ba vì mục đích quảng cáo thương mại.

## 3. Câu hỏi thường gặp về Giao diện & Tính năng

**Làm sao để đổi tên hiển thị hay thay ảnh đại diện?**
Bạn nhấp vào ảnh đại diện ở thanh điều hướng trên cùng để mở menu người dùng, chọn **Trang cá nhân (`/profile/[id]`)**, sau đó bấm nút **"Chỉnh sửa trang cá nhân"**. Tại đây bạn có thể cập nhật ảnh đại diện, ảnh bìa, tên hiển thị và tiểu sử.

**Tại sao bài viết của tôi lại bị giữ lại hoặc tạm ẩn?**
Để giữ cho Sentimeta luôn là môi trường an toàn và lành mạnh, hệ thống kiểm duyệt AI tự động nhận diện các nội dung có dấu hiệu xúc phạm, kích động bạo lực hoặc ngôn từ thù ghét. Nếu bài viết của bạn bị tạm ẩn, bạn có thể vào **Cài đặt → Lịch sử kiểm duyệt (`/settings/moderation-history`)** để xem lý do và gửi khiếu nại (appeal) để đội ngũ hỗ trợ xem xét lại.

**Trợ lý AI Sentimeta có thể giúp tôi những gì?**
Trợ lý AI có thể giải đáp hướng dẫn sử dụng, đồng hành tâm sự khi bạn căng thẳng, hướng dẫn bài tập hít thở / thư giãn cơ bắp, hỗ trợ điều hướng nhanh qua các nút bấm màn hình và thực thi các thao tác cơ bản (kết bạn, tham gia nhóm, đọc thông báo) với thẻ xác nhận minh bạch.

**Nếu tôi đang gặp khủng hoảng tâm lý nghiêm trọng và cần trợ giúp khẩn cấp?**
Đừng chịu đựng một mình. Hãy mở Trợ lý AI của Sentimeta và chia sẻ — hệ thống sẽ cung cấp ngay thông tin các đường dây nóng hỗ trợ tâm lý miễn phí 24/7:
- **1900 599 830** (Đường dây nóng Ngày Mai - Hỗ trợ khủng hoảng tâm lý & trầm cảm)
- **111** (Tổng đài Quốc gia Bảo vệ Trẻ em & Tham vấn Tâm lý)
- **115** (Cấp cứu y tế khẩn cấp)

---

Cảm ơn bạn đã lựa chọn Sentimeta làm nơi gửi gắm tâm tư. Chúng mình luôn đồng hành cùng bạn!
