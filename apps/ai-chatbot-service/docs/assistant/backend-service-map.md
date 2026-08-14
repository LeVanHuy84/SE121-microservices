---
id: backend-service-map
title: Bản đồ backend microservices
type: help_doc
visibility: internal
---

# Bản đồ backend microservices

Tài liệu này mô tả chi tiết vai trò của từng service trong repo `SE121-microservices`, cách các service phối hợp với nhau, và quy tắc để Assistant trả lời đúng ngữ cảnh khi dùng RAG.

## Mục tiêu sử dụng trong RAG

- Giúp Assistant định tuyến câu hỏi về đúng miền nghiệp vụ.
- Chuẩn hóa cách giải thích nguyên nhân lỗi theo kiến trúc microservices.
- Giảm trả lời suy đoán khi thiếu context runtime.

## Sơ đồ trách nhiệm tổng quát

1. Frontend gửi request vào `api-gateway`.
2. `api-gateway` thực hiện xác thực, kiểm tra quyền, gọi service nghiệp vụ tương ứng.
3. Service nguồn xử lý dữ liệu và có thể phát sự kiện (Kafka/RabbitMQ) cho các service downstream.
4. `chatbot-service` chỉ nhận context đã được lọc quyền + tài liệu RAG tĩnh để sinh câu trả lời.

## Danh mục service theo miền nghiệp vụ

### 1) api-gateway (NestJS)
- Vai trò: cổng vào thống nhất cho frontend/mobile.
- Trách nhiệm chính:
  - Xác thực người dùng.
  - Điều phối request tới đúng service backend.
  - Chuẩn hóa response cho client.
- Nhóm module chính: `users`, `social`, `posts`, `group`, `chat`, `chatbot`, `search`, `notification`, `media`, `music`, `emotion`, `admin`, `auth`, `feed`, `log`.

### 2) user-service (NestJS)
- Vai trò: quản lý hồ sơ người dùng và nghiệp vụ admin user.
- Thành phần chính: `user`, `admin`, `clerk`, `event`, `command`.
- Câu hỏi người dùng thường gặp: cập nhật hồ sơ, trạng thái tài khoản, vai trò người dùng.

### 3) social-service (NestJS)
- Vai trò: xử lý đồ thị quan hệ bạn bè.
- Chức năng chính: gửi/huỷ/chấp nhận kết bạn, chặn/bỏ chặn, kiểm tra relationship.
- Thành phần chính: `friendship`, `event`, `postgres`, `client`.

### 4) recommendation-service (FastAPI + Python)
- Vai trò: máy gợi ý bạn bè.
- Pipeline chính:
  - Lấy candidate bằng semantic retrieval (pgvector).
  - Lọc theo graph rules (không tự gợi ý, không gợi ý user bị block, không gợi ý bạn đã kết bạn).
  - Rerank theo điểm model + tín hiệu graph.
  - Dùng global fallback khi truy hồi chính không đủ dữ liệu.
- Endpoint nội bộ: `POST /recommend/query`, `GET /recommend/query-cache`, `GET /ready`, `GET /health`.

### 5) post-service (NestJS)
- Vai trò: quản lý nội dung bài viết và tương tác.
- Miền dữ liệu: post, comment, reaction, share, report, stats.
- Thành phần chính: `post`, `comment`, `reaction`, `share`, `report`, `consumer`.

### 6) group-service (NestJS)
- Vai trò: quản lý nhóm cộng đồng.
- Miền dữ liệu: thông tin nhóm, cài đặt nhóm, thành viên, lời mời, yêu cầu tham gia, log, báo cáo nhóm.
- Thành phần chính: `group-core`, `member`, `group-invite`, `group-request`, `report`, `group-log`.

### 7) chat-service (NestJS)
- Vai trò: nhắn tin thời gian thực.
- Miền dữ liệu: conversation, message, trạng thái hiện diện (presence), push.
- Thành phần chính: `conversation`, `message`, `presence`, `push`, `outbox`, `mongo`.

### 8) chatbot-service (FastAPI + Python)
- Vai trò: điều phối AI Assistant.
- Thành phần chính:
  - API: `app/api/assistant_api.py`
  - Dịch vụ lõi: `assistant_service`, `context_resolver`, `prompt_builder`, `rag_document_service`, `chat_history_service`
  - Provider: `groq_provider`
- Lưu ý quan trọng: không tự truy cập trực tiếp dữ liệu nghiệp vụ; chỉ dùng context đã được cấp.

### 9) search-service (NestJS)
- Vai trò: tìm kiếm hợp nhất user/group/post.
- Thành phần chính: `search-all`, `indexer`, `post`, `group`, `user`, `consumer`.
- Đặc thù: phụ thuộc mạnh vào độ trễ đồng bộ index.

### 10) feed-service (NestJS)
- Vai trò: xây dựng feed cá nhân và trending.
- Thành phần chính: `feed-pipeline`, `ranking`, `affinity`, `cache-layer`, `ingestion`, `consumer`.

### 11) emotion-intelligence-service (NestJS)
- Vai trò: cung cấp dashboard và insight cảm xúc.
- Thành phần chính: `dashboard`, `insight`, `ingestion`, `snapshot`, `warning`, `feedback`, `profile`, `ai`.

### 12) analysis-service (FastAPI + Python)
- Vai trò: phân tích cảm xúc và moderation bằng AI (text/image/music).
- Endpoint nội bộ tiêu biểu: `GET /emotion/dashboard`, `POST /musics/analyze`, `GET /health`.
- Bảo mật: yêu cầu `X-Internal-Key`.

### 13) music-service (NestJS)
- Vai trò: quản lý catalog nhạc và recommendation liên quan.
- Thành phần chính: `catalog`, `recommendation`, `discovery`.

### 14) media-service (NestJS)
- Vai trò: upload media và xử lý lifecycle file.
- Thành phần chính: `media`, `consumer`, webhook cloudinary.

### 15) notification-service (NestJS)
- Vai trò: gửi thông báo và quản lý thiết bị nhận push.
- Thành phần chính: `notification`, `firebase/device-token`, `user-preference`.

### 16) logging-service (NestJS)
- Vai trò: tập trung log vận hành và log sự kiện nghiệp vụ.
- Thành phần chính: `log`, `consumer`.

## Quy tắc trả lời cho Assistant

- Khi thiếu context runtime, phải nói rõ “chưa có đủ dữ liệu để kết luận”.
- Không suy đoán dữ liệu nhạy cảm hoặc dữ liệu private.
- Không hứa thực thi thao tác ghi dữ liệu thay người dùng.
- Khi người dùng hỏi lỗi, ưu tiên khung phân tích:
  - quyền truy cập,
  - trạng thái tài nguyên,
  - độ trễ đồng bộ/event/index,
  - điều kiện lọc và đầu vào.
