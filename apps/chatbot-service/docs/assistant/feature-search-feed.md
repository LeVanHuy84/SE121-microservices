---
id: feature-search-feed
title: Tính năng Tìm kiếm và Bảng tin
type: help_doc
visibility: internal
---

# Tính năng Tìm kiếm và Bảng tin

## Phạm vi

- Tìm kiếm tổng hợp user/group/post.
- Feed cá nhân.
- Feed thịnh hành (trending).

## Service liên quan

- `api-gateway`: endpoint `search/*`, `feeds/*`.
- `search-service`: index và truy vấn search.
- `feed-service`: pipeline ranking và phân phối feed.

## Luồng nghiệp vụ chính

1. Người dùng tìm kiếm hoặc mở feed.
2. Gateway gọi `search-service` hoặc `feed-service`.
3. Các service downstream cập nhật dữ liệu qua event consumer/indexer/ranker.

## Nguyên nhân lỗi thường gặp

- Tìm không ra dữ liệu:
  - index chưa cập nhật,
  - từ khóa không trùng metadata,
  - bộ lọc quá hẹp,
  - không đủ quyền xem nội dung.
- Feed chưa cá nhân hoá tốt:
  - tín hiệu tương tác còn ít,
  - cache chưa hết TTL,
  - sự kiện ingestion chưa xử lý xong.
- Trending thay đổi bất thường:
  - cửa sổ thời gian tính điểm thay đổi,
  - volume event tăng/giảm đột biến.

## Hướng dẫn trả lời cho Assistant

- Dùng checklist 4 bước khi người dùng báo lỗi tìm kiếm:
  1. Kiểm tra quyền truy cập.
  2. Kiểm tra từ khóa và bộ lọc.
  3. Kiểm tra khả năng trễ index.
  4. Thử làm mới truy vấn.
- Không khẳng định “không tồn tại dữ liệu” nếu chưa có context xác nhận.

## Câu hỏi mẫu nên xử lý tốt

- “Tại sao tôi không tìm thấy bài vừa đăng?”
- “Vì sao bảng tin của tôi lặp nhiều nội dung?”
- “Feed thịnh hành được tính như thế nào?”
