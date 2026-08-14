---
id: feature-user-social
title: Tính năng Người dùng và Quan hệ xã hội
type: help_doc
visibility: internal
---

# Tính năng Người dùng và Quan hệ xã hội

## Phạm vi

Tài liệu này bao phủ các chức năng:
- Hồ sơ người dùng.
- Quan hệ bạn bè.
- Chặn/bỏ chặn.
- Gợi ý kết bạn.

## Service liên quan

- `api-gateway`: điểm vào API cho client.
- `user-service`: quản lý hồ sơ, vai trò, trạng thái tài khoản.
- `social-service`: xử lý vòng đời friendship và relationship.
- `recommendation-service`: tính toán danh sách gợi ý bạn bè.

## Luồng nghiệp vụ chính

1. Người dùng thao tác trên UI (kết bạn, chặn, cập nhật hồ sơ).
2. Request đi qua `api-gateway` để xác thực và kiểm tra scope.
3. Gateway gọi `user-service` hoặc `social-service`.
4. Sự kiện profile/graph được phát để `recommendation-service` cập nhật candidate.

## Nguyên nhân lỗi thường gặp

- Không gửi được lời mời kết bạn:
  - người nhận đã bị chặn,
  - đã có request đang chờ,
  - tài khoản mục tiêu không hợp lệ.
- Không thấy gợi ý bạn bè:
  - hồ sơ chưa đủ tín hiệu,
  - dữ liệu graph còn mỏng,
  - fallback đang thay thế semantic retrieval.
- Trạng thái quan hệ không như mong đợi:
  - dữ liệu vừa thay đổi nhưng client chưa refresh,
  - chưa đồng bộ xong event downstream.

## Hướng dẫn trả lời cho Assistant

- Với câu hỏi thao tác: trả lời theo từng bước thao tác trong app.
- Với câu hỏi “vì sao không kết bạn được”: phân tích theo thứ tự `block -> request tồn tại -> quyền truy cập -> trạng thái tài khoản`.
- Không suy đoán trạng thái quan hệ nếu context không có dữ liệu `relationship` hiện tại.

## Câu hỏi mẫu nên xử lý tốt

- “Tại sao tôi không gửi lời mời kết bạn được?”
- “Vì sao danh sách gợi ý bạn bè thay đổi liên tục?”
- “Tôi đã bỏ chặn rồi nhưng vẫn chưa kết bạn được?”
