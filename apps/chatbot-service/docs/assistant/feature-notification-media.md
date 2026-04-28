---
id: feature-notification-media
title: Tính năng Thông báo và Media
type: help_doc
visibility: internal
---

# Tính năng Thông báo và Media

## Phạm vi

- Đăng ký và quản lý device token.
- Thiết lập tùy chọn nhận thông báo.
- Gửi thông báo theo sự kiện nghiệp vụ.
- Upload media và đồng bộ trạng thái file.

## Service liên quan

- `api-gateway`: endpoint `notifications/*`, `media/*`.
- `notification-service`: notification, device-token, user-preference.
- `media-service`: upload lifecycle, webhook cloudinary, consumer.

## Luồng nghiệp vụ chính

1. Client đăng ký token thiết bị.
2. Notification pipeline phát thông báo theo sự kiện.
3. Upload media kích hoạt webhook để cập nhật trạng thái xử lý file.

## Nguyên nhân lỗi thường gặp

- Không nhận được thông báo:
  - token hết hạn hoặc sai,
  - người dùng đã tắt preference,
  - quyền thông báo ở hệ điều hành bị tắt.
- Upload xong nhưng chưa hiển thị:
  - webhook chưa callback,
  - media đang trạng thái pending/failed,
  - lỗi mạng khi đồng bộ metadata file.

## Hướng dẫn trả lời cho Assistant

- Khi xử lý lỗi notification, luôn hướng dẫn kiểm tra theo thứ tự:
  1. quyền thông báo trên thiết bị,
  2. token đang đăng ký,
  3. preference trong ứng dụng.
- Với media, giải thích rõ tính chất bất đồng bộ của webhook.

## Câu hỏi mẫu nên xử lý tốt

- “Vì sao tôi không nhận được thông báo push?”
- “Tại sao ảnh đã tải lên nhưng chưa xuất hiện?”
- “Làm sao xoá toàn bộ token thiết bị cũ?”
