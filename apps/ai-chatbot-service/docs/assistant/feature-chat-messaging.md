---
id: feature-chat-messaging
title: Tính năng Chat và Nhắn tin
type: help_doc
visibility: internal
---

# Tính năng Chat và Nhắn tin

## Phạm vi

- Quản lý cuộc trò chuyện (conversation).
- Gửi/thu hồi/xóa tin nhắn.
- Trạng thái đã đọc.
- Trạng thái hiện diện (presence) và push notification.

## Service liên quan

- `api-gateway`: endpoint `chats/*`.
- `chat-service`: conversation, message, presence, push, outbox.

## Luồng nghiệp vụ chính

1. Client gọi API chat qua gateway.
2. Gateway xác thực và chuyển tiếp sang `chat-service`.
3. `chat-service` lưu message, cập nhật state conversation.
4. Push/presence được xử lý theo pipeline tương ứng.

## Nguyên nhân lỗi thường gặp

- Không thấy tin nhắn mới:
  - conversation đang bị ẩn,
  - đồng bộ client-server trễ,
  - token push không hợp lệ.
- Không tạo được cuộc trò chuyện:
  - target user không hợp lệ,
  - quan hệ người dùng bị chặn,
  - payload thành viên thiếu.
- Đã đọc nhưng trạng thái chưa đổi ngay:
  - độ trễ đồng bộ trạng thái đọc.

## Hướng dẫn trả lời cho Assistant

- Chỉ hướng dẫn thao tác; không tự truy vấn nội dung chat nếu không có context runtime.
- Khi người dùng hỏi “mất tin nhắn”, ưu tiên kiểm tra bộ lọc conversation, trạng thái ẩn, và đồng bộ.

## Câu hỏi mẫu nên xử lý tốt

- “Tại sao tôi không gửi được tin nhắn?”
- “Vì sao cuộc trò chuyện bị ẩn?”
- “Làm sao đánh dấu đã đọc toàn bộ?”
