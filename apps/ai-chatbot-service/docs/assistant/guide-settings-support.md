---
id: guide-settings-support
title: Hướng dẫn Cài đặt Tài khoản, Quyền riêng tư và Trung tâm Trợ giúp
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Cài đặt Tài khoản, Quyền riêng tư và Trung tâm Trợ giúp

Sentimeta cung cấp trung tâm cài đặt toàn diện giúp bạn chủ động quản lý tài khoản, cá nhân hóa quyền riêng tư, quản lý hồ sơ cá nhân, theo dõi nhật ký hoạt động và gửi khiếu nại khi cần hỗ trợ.

## 1. Truy cập Trung tâm Cài đặt (`/settings`)

- Bấm vào ảnh đại diện (avatar) của bạn ở góc trên thanh điều hướng để mở menu tài khoản, sau đó chọn **"Cài đặt" (`/settings`)**.
- Trên màn hình máy tính (Web), bảng điều khiển cài đặt bên trái bao gồm các danh mục chức năng rõ ràng:

---

### 1.1. Chỉnh sửa Hồ sơ và Thông tin Cá nhân

Khi bạn muốn thay đổi ảnh đại diện (avatar), ảnh bìa, họ tên hoặc tiểu sử (bio), bạn có thể thao tác theo các bước sau:

1. **Vào Trang cá nhân:** Bấm vào ảnh đại diện ở thanh điều hướng góc trên bên phải màn hình, chọn **"Trang cá nhân" (`/profile/[userId]`)**.
2. **Mở hộp thoại chỉnh sửa:** Nhấp vào nút **"Chỉnh sửa trang cá nhân"** (biểu tượng cây bút Pencil bên cạnh tên của bạn). Hộp thoại `ProfileModal` sẽ xuất hiện.
3. **Cập nhật các thông tin:**
   - **Ảnh đại diện (Avatar):** Nhấp vào biểu tượng máy ảnh trên vòng tròn ảnh đại diện để tải ảnh mới từ máy tính hoặc điện thoại của bạn.
   - **Ảnh bìa (Cover Image):** Nhấp vào nút "Thay đổi ảnh bìa" ở góc trên của ảnh bìa để chọn ảnh mới.
   - **Họ và Tên (First Name, Last Name):** Nhập họ và tên hiển thị mới của bạn.
   - **Tiểu sử / Giới thiệu bản thân (Bio):** Nhập mô tả ngắn về bản thân bạn (tối đa 200 ký tự) để chia sẻ góc nhìn hoặc châm ngôn sống.
   - **Thông tin bổ sung:** Bạn cũng có thể cập nhật Vị trí (Location), Nghề nghiệp (Job title), Công ty (Company), Trường học (School) và các Sở thích (Interests).
4. **Lưu thay đổi:** Nhấp vào nút **"Cập nhật hồ sơ"** ở cuối hộp thoại để lưu các thay đổi. Thông tin mới sẽ hiển thị ngay lập tức trên trang cá nhân của bạn.

---

### 1.2. Cài đặt Quyền riêng tư Toàn diện (`/settings/privacy`)

Tại trang **Cài đặt → Quyền riêng tư (`/settings/privacy`)**, Sentimeta cung cấp 4 khu vực thiết lập bảo vệ thông tin cá nhân:

#### A. Ai có thể xem hồ sơ của bạn? (`profileVisibility`)
- **Mọi người (Public):** Bất kỳ ai trên Sentimeta cũng có thể xem bài viết và thông tin trang cá nhân của bạn.
- **Bạn bè (Friends):** Chỉ những người đã kết bạn mới có thể xem các chia sẻ và hồ sơ của bạn.
- **Chỉ mình tôi (Private):** Khóa bảo vệ hồ sơ tối đa, người khác sẽ không thấy nội dung bài đăng trên tường nhà bạn.

#### B. Ai có thể xem danh sách bạn bè của bạn? (`friendListVisibility`)
- **Mọi người (Public):** Bất kỳ ai cũng có thể thấy danh sách bạn bè của bạn.
- **Bạn bè (Friends):** Chỉ bạn bè của bạn mới thấy danh sách này.
- **Chỉ mình tôi (Private):** Giấu hoàn toàn danh sách bạn bè, chỉ riêng bạn mới xem được.

#### C. Ai có thể nhắn tin cho bạn? (`messagePrivacy` - Ngăn chặn người lạ nhắn tin)
- **Mọi người (Everyone):** Bất kỳ ai cũng có thể gửi tin nhắn cho bạn.
- **Chỉ bạn bè (Friends):** **Chỉ những người đã kết bạn mới có thể nhắn tin cho bạn**. Khi bật tùy chọn này, người lạ hoàn toàn không thể gửi tin nhắn rác hoặc làm phiền bạn. Đây là cách tốt nhất để bảo vệ không gian trò chuyện riêng tư.

#### D. Quyền riêng tư Trợ lý AI Chatbot (`aiPolicy`)
- **Đầy đủ tính năng - Khuyên dùng (FULL):** Cho phép Trợ lý AI tra cứu dữ liệu cá nhân của bạn trên Sentimeta (bạn bè, lời mời kết bạn, nhóm, thông báo, nhật ký cảm xúc, lịch sử kiểm duyệt), hiển thị **Thẻ tương tác trực quan (Interactive Mini Cards)** giúp thao tác nhanh (kết bạn, chấp nhận lời mời, tham gia nhóm) và đề xuất xác nhận thao tác toàn cục an toàn như *Đánh dấu đã đọc tất cả thông báo*.
- **Riêng tư tối đa (RESTRICTED):** Trợ lý AI vẫn giải đáp kiến thức tâm lý, hướng dẫn sử dụng ứng dụng và cung cấp **nút điều hướng** đến các màn hình cần thiết (kèm lối tắt đến `/settings/privacy` khi bạn hỏi về dữ liệu cá nhân). AI hoàn toàn **không đọc dữ liệu cá nhân** của bạn và **không thực hiện bất kỳ thao tác thay đổi tài khoản nào**.

#### E. Cho phép AI can thiệp chủ động (`allowProactiveIntervention`)
- Công tắc bật/tắt tính năng Trợ lý AI chủ động hỏi thăm khi phát hiện bạn có biểu hiện căng thẳng tâm lý kéo dài qua nhật ký cảm xúc. Bạn có thể tắt bất cứ lúc nào nếu muốn giữ không gian yên tĩnh.

#### F. Quản lý danh sách đã chặn (`/friends/blocked`)
- Xem danh sách tất cả những người dùng bạn đang chặn. Bấm nút **"Bỏ chặn" (Unblock)** khi bạn muốn khôi phục lại khả năng tìm kiếm và liên hệ với người đó.

---

### 1.3. Tài khoản & Bảo mật (Account & Security)
- **Đổi mật khẩu:** Cập nhật mật khẩu mới an toàn được bảo vệ thông qua hệ thống Clerk Authentication.
- **Quên mật khẩu:** Tại màn hình đăng nhập, nhấp vào **"Quên mật khẩu?"** và làm theo hướng dẫn nhập mã xác nhận gửi về email để thiết lập lại mật khẩu.
- **Thông tin đăng nhập:** Quản lý địa chỉ Email liên kết và phương thức đăng nhập tài khoản.

---

### 1.4. Cài đặt Thông báo (`/settings/notification-settings`)
- Tùy chỉnh bật hoặc tắt nhận thông báo đẩy trong ứng dụng cho các sự kiện:
  - Lượt thả biểu tượng cảm xúc (Reaction) trên bài viết hoặc bình luận.
  - Bình luận và phản hồi mới.
  - Lời mời kết bạn hoặc phản hồi kết bạn.
  - Hoạt động và bài viết mới trong các nhóm bạn tham gia.
  - Tin nhắn mới từ bạn bè.

---

### 1.5. Nhật ký Hoạt động (`/settings/activity`)
- Nơi lưu trữ dòng thời gian tất cả các tương tác bạn đã thực hiện trên Sentimeta:
  - Danh sách bài viết bạn đã đăng.
  - Lịch sử các bài viết bạn đã thả cảm xúc (Like, Love, Haha, Wow, Sad, Angry).
  - Lịch sử các bình luận bạn đã để lại trên bài viết của cộng đồng.

---

### 1.6. Lịch sử Kiểm duyệt và Khiếu nại (`/settings/moderation-history`)
- **Xem bài viết bị gắn cờ:** Nơi hiển thị tất cả các bài viết hoặc nội dung của bạn từng bị hệ thống AI tự động phát hiện vi phạm tiêu chuẩn cộng đồng hoặc bị tạm ẩn.
- **Thông tin chi tiết:** Xem ngày vi phạm, lý do gắn cờ (ví dụ: phát hiện ngôn từ tiêu cực hoặc hình ảnh không an toàn) và trạng thái xử lý hiện tại.
- **Gửi khiếu nại (Appeal):** Nếu bài viết của bạn bị nhận diện nhầm, hãy bấm nút **"Gửi khiếu nại" (Appeal)** bên cạnh bài viết. Đội ngũ kiểm duyệt viên sẽ xem xét lại và khôi phục nội dung nếu bài viết đạt chuẩn.

---

### 1.7. Trung tâm Trợ giúp & Hỗ trợ (`/settings/support`)
- **Câu hỏi thường gặp (FAQ):** Tra cứu hướng dẫn giải quyết các sự cố phổ biến về tài khoản, bài viết và giao diện.
- **Gửi phản hồi / Báo cáo sự cố:** Biểu mẫu gửi ý kiến đóng góp, góp ý cải tiến hoặc phản ánh lỗi kỹ thuật trực tiếp tới đội ngũ kỹ sư Sentimeta.

---

### 1.8. Câu hỏi thường gặp & Giới hạn tính năng (FAQ)
- **Sentimeta có hỗ trợ mua bán hàng hóa hoặc tiền ảo Bitcoin không?**
  - Không. Sentimeta là mạng xã hội chia sẻ cảm xúc và sức khỏe tinh thần phi thương mại, **hoàn toàn không hỗ trợ** các tính năng giao dịch tài chính, mua bán hàng hóa thương mại điện tử hay ví tiền ảo Bitcoin.
- **Làm sao để đổi mật khẩu tài khoản?**
  - Bạn vào menu tài khoản, chọn Cài đặt và sử dụng tính năng quản lý tài khoản Clerk để đổi mật khẩu bảo mật.
