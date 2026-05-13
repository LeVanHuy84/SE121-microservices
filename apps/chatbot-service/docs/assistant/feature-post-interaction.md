---
id: feature-post-interaction
title: Tính năng Bài viết và Tương tác
type: help_doc
visibility: internal
---

# Tính năng Bài viết và Tương tác

## Phạm vi

Bao gồm các nghiệp vụ:
- Tạo/sửa/xoá bài viết.
- Bình luận.
- Reaction.
- Chia sẻ.
- Báo cáo nội dung.

## Service liên quan

- `api-gateway`: điều phối request từ client.
- `post-service`: service nguồn cho post/comment/reaction/share/report.
- `analysis-service`: hỗ trợ moderation/cảm xúc nội dung ở các luồng liên quan AI.

## Luồng nghiệp vụ chính

1. Client gửi thao tác qua gateway.
2. Gateway xác thực danh tính và quyền truy cập.
3. `post-service` xử lý ghi/đọc dữ liệu.
4. Event có thể được phát tới feed/search/analytics để đồng bộ.

## Nguyên nhân lỗi thường gặp

- Không sửa hoặc xoá được bài viết:
  - không phải chủ sở hữu,
  - bài viết bị khoá,
  - bài viết đã bị ẩn do moderation.
- Reaction hiển thị chậm:
  - cache/feed chưa cập nhật tức thì (eventual consistency).
- Đã report nhưng chưa có thay đổi:
  - report vào hàng đợi xử lý moderation,
  - chưa đến bước xử lý của admin/moderator.

## Hướng dẫn trả lời cho Assistant

- Không bịa nội dung bài viết nếu context không chứa payload post.
- Khi người dùng hỏi bài bị mất, ưu tiên giải thích theo: privacy, moderation, quyền xem, trạng thái publish.
- Nếu là thao tác ghi dữ liệu, chỉ hướng dẫn qua UI/API, không hứa “đã thực hiện”.

## Câu hỏi mẫu nên xử lý tốt

- “Tại sao tôi không sửa được bài viết của mình?”
- “Vì sao reaction chưa cập nhật ngay?”
- “Report nội dung bao lâu thì được xử lý?”
