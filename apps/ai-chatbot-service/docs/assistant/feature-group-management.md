---
id: feature-group-management
title: Tính năng Quản lý Nhóm
type: help_doc
visibility: internal
---

# Tính năng Quản lý Nhóm

## Phạm vi

Tài liệu này bao phủ:
- Tạo và cập nhật nhóm.
- Quản trị thành viên và vai trò.
- Lời mời và yêu cầu tham gia.
- Cài đặt quyền riêng tư nhóm.
- Báo cáo nhóm và nhật ký sự kiện nhóm.

## Service liên quan

- `api-gateway`: route nhóm cho client.
- `group-service`: xử lý nghiệp vụ nhóm theo permission.

## Luồng nghiệp vụ chính

1. Người dùng thao tác qua endpoint nhóm ở gateway.
2. `group-service` kiểm tra role (owner/admin/member) và policy quyền.
3. Nếu hợp lệ thì áp dụng thay đổi dữ liệu và ghi log sự kiện nhóm.

## Nguyên nhân lỗi thường gặp

- Không tham gia được nhóm:
  - nhóm riêng tư,
  - yêu cầu chưa được duyệt,
  - người dùng bị cấm trong nhóm.
- Không đổi được vai trò thành viên:
  - người thao tác không đủ quyền,
  - target role vi phạm policy (ví dụ member không thể nâng owner).
- Không mời được người dùng:
  - đã có lời mời tồn tại,
  - người dùng mục tiêu bị hạn chế theo cài đặt nhóm.

## Hướng dẫn trả lời cho Assistant

- Với lỗi nhóm, mặc định phân tích theo role và policy trước.
- Không khẳng định danh sách thành viên nếu context không có dữ liệu members hiện tại.
- Nếu người dùng hỏi hành động quản trị, trả lời rõ điều kiện quyền tương ứng.

## Câu hỏi mẫu nên xử lý tốt

- “Tại sao tôi không đổi được quyền thành viên?”
- “Vì sao gửi yêu cầu vào nhóm rồi mà chưa vào được?”
- “Nhóm riêng tư và nhóm công khai khác nhau thế nào?”
