---
id: guide-group-social
title: Hướng dẫn Quản lý Bạn bè, Mối quan hệ Xã hội và Nhóm Cộng đồng
topic: huong-dan
lang: vi
version: v2
tier: system_guide
---
# Kết nối Bạn bè và Gắn kết Cộng đồng

Sentimeta cung cấp các công cụ xã hội ấm áp, an toàn và dễ sử dụng để bạn tìm kiếm những người bạn đồng điệu và tham gia vào các không gian cộng đồng tích cực.

## 1. Quản lý Mạng lưới Bạn bè (`/friends`)

Truy cập mục **"Bạn bè" (`/friends`)** trên thanh điều hướng chính để khám phá 4 khu vực chức năng:

- **Danh sách Bạn bè (`/friends`):**
  - Hiển thị danh sách tất cả những người bạn hiện tại của bạn trên Sentimeta.
  - Bạn có thể nhấp vào tên để xem Trang cá nhân (`/profile/[id]`), bấm nút **"Nhắn tin"** để mở khung trò chuyện, hoặc bấm menu tùy chọn để **"Hủy kết bạn" (Unfriend)** hoặc **"Chặn" (Block)** người dùng.
  - **Lưu ý về Hủy kết bạn (Unfriend):** Khi bạn bấm hủy kết bạn với một người, thao tác này diễn ra hoàn toàn âm thầm. Sentimeta **hoàn toàn KHÔNG gửi thông báo** nào cho người đó để bảo vệ sự riêng tư và tránh gây khó xử. Người đó chỉ có thể biết khi vào lại trang cá nhân của bạn và thấy nút "Kết bạn" xuất hiện lại.

- **Lời mời kết bạn (`/friends/requests`):**
  - **Lời mời nhận được:** Danh sách những người đã gửi yêu cầu kết bạn tới bạn. Nhấp nút **"Chấp nhận"** để trở thành bạn bè hoặc **"Từ chối"** để bỏ qua lời mời.
  - **Lời mời đã gửi:** Danh sách các yêu cầu kết bạn bạn đã gửi đi đang chờ phản hồi. Bạn có thể bấm nút **"Thu hồi"** nếu muốn rút lại yêu cầu.

- **Gợi ý bạn bè (`/friends/suggestions`):**
  - Hệ thống gợi ý bạn bè (Friend Recommendation Engine) phân tích đề xuất những người bạn phù hợp dựa trên 4 tiêu chí cốt lõi:
    1. **Số lượng bạn chung (Mutual Friends / Social Graph):** Đây là tiêu chí quan trọng nhất, ưu tiên những người có nhiều mối liên kết chung với bạn.
    2. **Nhóm cộng đồng tham gia chung:** Những thành viên cùng sinh hoạt trong các nhóm bạn yêu thích.
    3. **Sở thích và gu âm nhạc cảm xúc:** Đề xuất dựa trên điểm tương đồng về sở thích và thói quen nghe nhạc chữa lành.
    4. **Mức độ tương tác tích cực trên bảng tin:** Những người thường xuyên tương tác cùng bài viết hoặc chủ đề chung.
  - Nhấp nút **"Thêm bạn bè"** để gửi ngay lời mời kết bạn hoặc bấm **"Gỡ bỏ"** để bỏ qua gợi ý.

- **Danh sách đã chặn (`/friends/blocked`):**
  - Nơi quản lý các tài khoản bạn đã chặn để ngăn chặn liên lạc hoặc tương tác.
  - Bấm nút **"Bỏ chặn" (Unblock)** khi bạn muốn khôi phục lại khả năng tìm kiếm và kết nối với người đó.

**Thao tác kết bạn trên Trang cá nhân của người khác:**
Khi ghé thăm trang cá nhân của một người dùng, nút quan hệ sẽ hiển thị trạng thái phù hợp:
- **"Kết bạn":** Chưa có quan hệ bạn bè, nhấp vào để gửi lời mời.
- **"Đã gửi lời mời":** Yêu cầu đang chờ đối phương phản hồi (bấm vào để thu hồi).
- **"Phản hồi lời mời":** Người đó đã gửi yêu cầu cho bạn (bấm vào để chấp nhận hoặc từ chối).
- **"Bạn bè":** Đã là bạn bè (nhấp vào để mở tùy chọn Nhắn tin, Hủy kết bạn hoặc Chặn).

---

## 2. Khám phá và Quản lý Nhóm Cộng đồng (`/groups`)

Mục **"Nhóm" (`/groups`)** là không gian giao lưu theo sở thích, học tập hoặc hỗ trợ tâm lý với 3 phân mục:

- **Khám phá nhóm (`/groups/explore`):**
  - Tìm kiếm và duyệt qua danh mục các cộng đồng nổi bật theo chủ đề (Tâm lý học, Âm nhạc, Đọc sách, Nghệ thuật, Lối sống tích cực...).
  - Nhấp nút **"Tham gia" (Join)** đối với nhóm công khai để vào ngay nhóm, hoặc **"Yêu cầu tham gia"** đối với nhóm riêng tư để chờ ban quản trị duyệt.

- **Nhóm của tôi (`/groups/my-groups`):**
  - Hiển thị danh sách tất cả các nhóm bạn đang là thành viên hoặc quản trị viên (Admin).
  - Nút **"Tạo nhóm mới"**: Nhấp vào để mở modal tạo cộng đồng của riêng bạn. Bạn có thể đặt Tên nhóm, Mô tả, tải Ảnh đại diện / Ảnh bìa và thiết lập Quyền riêng tư (Nhóm Công khai hoặc Nhóm Riêng tư).

- **Lời mời vào nhóm (`/groups/invites`):**
  - Danh sách lời mời tham gia nhóm được gửi đến bạn từ bạn bè. Bạn có thể chọn **"Chấp nhận"** để gia nhập nhóm hoặc **"Từ chối"** để bỏ qua.

- **Trang chi tiết Nhóm (`/groups/[groupId]`):**
  - **Bảng tin nhóm:** Đăng bài, bình luận và chia sẻ nội dung riêng biệt dành riêng cho các thành viên trong nhóm.
  - **Tab Thành viên (`/groups/[groupId]/members`):** Xem danh sách quản trị viên, người kiểm duyệt và các thành viên tham gia.
  - **Cách Rời khỏi nhóm cộng đồng:**
    - Truy cập trang chi tiết nhóm bạn muốn rời.
    - Tại phần tiêu đề nhóm, nhấp vào nút trạng thái thành viên **"Đã tham gia"** $\to$ Hộp thoại xác nhận hiển thị $\to$ chọn **"Rời nhóm"** (`POST /groups/:groupId/members/leave`). Bạn sẽ không còn là thành viên và không nhận thông báo bài viết mới từ nhóm này nữa.
  - **Báo cáo nhóm vi phạm tiêu chuẩn cộng đồng:**
    - Nếu phát hiện nhóm có nội dung thù ghét, độc hại hoặc lừa đảo: bấm vào biểu tượng dấu 3 chấm (`...`) trên trang bìa nhóm $\to$ chọn **"Báo cáo nhóm"** $\to$ Chọn lý do và gửi khiếu nại để ban quản trị hệ thống xử lý.
  - **Quyền hạn của Quản trị viên (Group Admin):**
    - **Kiểm duyệt bài viết:** Trưởng nhóm có toàn quyền duyệt bài, từ chối bài hoặc xóa bất kỳ bài viết/bình luận nào của thành viên nếu vi phạm quy định nhóm.
    - **Quản lý thành viên:** Phê duyệt yêu cầu tham gia, xóa hoặc cấm (ban) thành viên tái phạm vi phạm nội quy khỏi nhóm.
    - **Đổi vai trò & Phân quyền:** Quản trị viên có thể thăng cấp thành viên tích cực lên làm Quản trị viên hoặc Người kiểm duyệt.
    - **Xem Nhật ký hoạt động nhóm (Group Logs - `/groups/[groupId]/logs`):** Nơi ghi lại đầy đủ lịch sử kiểm duyệt bài viết, phê duyệt thành viên và thay đổi cài đặt nhóm của ban quản trị để đảm bảo tính minh bạch.

---

## 3. Điều hướng và Thao tác Nhanh với Trợ lý AI

Trợ lý AI Sentimeta hỗ trợ bạn quản lý quan hệ bạn bè và nhóm cực kỳ tiện lợi (khi bật chế độ **Đầy đủ tính năng - `FULL`** tại `/settings/privacy`):
- **Hỏi thông tin & Điều hướng nhanh:** Bạn có thể hỏi *"Tôi có lời mời kết bạn nào không?"*, *"Gợi ý nhóm phù hợp với tôi"*, *"Cách rời nhóm tâm lý"* — Trợ lý sẽ hiển thị thẻ tóm tắt trực quan (`Mini Cards`) và nút bấm trực tiếp đưa bạn đến trang tương ứng (`[Đến trang Bạn bè]`, `[Xem Lời mời kết bạn]`, `[Khám phá nhóm]`).
- **Thao tác trực tiếp trên Thẻ Tương tác (Interactive Mini Cards):** Khi bạn tìm kiếm người dùng, lời mời kết bạn hoặc nhóm gợi ý, Trợ lý sẽ hiển thị các thẻ có nút thao tác trực tiếp ngay trên thẻ cho những hành động an toàn (như **Kết bạn**, **Chấp nhận lời mời**, **Tham gia nhóm**). Đối với các thao tác nhạy cảm có tính hủy bỏ (như **Hủy kết bạn**, **Rời nhóm**, **Chặn người dùng**), Trợ lý không tự ý thực thi mà chỉ hiển thị thẻ xem nhanh kèm liên kết mở đúng trang để bạn tự xác nhận an toàn.
