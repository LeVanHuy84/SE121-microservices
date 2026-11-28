# RUNBOOK VẬN HÀNH & XỬ LÝ SỰ CỐ (PRODUCTION RUNBOOK)

> **Hệ thống:** `SE121-microservices`  
> **Cập nhật:** 28/11/2026  

---

## 1. KHỞI ĐỘNG & KIỂM TRA SỨC KHỎE HỆ THỐNG

### 1.1 Lệnh thao tác nhanh (Copy & Paste)
Đảm bảo đã cấu hình `.env.production.local` (từ `.env.production.example`) và các file `apps/<service>/.env.production.local` (từ `apps/<service>/.env.production.example`).

```bash
# Build & khởi động toàn bộ Production
docker compose -f docker-compose.prod.yml --env-file .env.production.local up -d --build

# Xem trạng thái & healthcheck
docker compose -f docker-compose.prod.yml --env-file .env.production.local ps

# Xem log realtime của 1 service (ví dụ api-gateway, ai-chatbot-service)
docker compose -f docker-compose.prod.yml --env-file .env.production.local logs -f --tail=100 <service>

# Restart 1 service cụ thể (giữ nguyên các service khác)
docker compose -f docker-compose.prod.yml --env-file .env.production.local up -d --no-deps --build <service>

# Dừng toàn bộ stack (GIỮ NGUYÊN dữ liệu volumes)
docker compose -f docker-compose.prod.yml --env-file .env.production.local down

# Xem tiêu hao RAM/CPU realtime
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

```powershell
# Kiểm tra nhanh Gateway Health & Readiness (PowerShell)
curl.exe -s http://localhost:4000/api/v1/health
curl.exe -s http://localhost:4000/api/v1/ready
```

### 1.2 Điểm kiểm tra nhanh (Health, Ready, Metrics, UI)
- **API Gateway Liveness / Readiness:** `GET http://localhost:4000/api/v1/health` | `GET http://localhost:4000/api/v1/ready`
- **Backend Microservices Readiness:** `GET http://<container>:5001..5005/ready`
- **AI Chatbot Service:** `GET http://<container>:4006/health` | `GET http://<container>:4006/ready`
- **Các giao diện giám sát (chỉ mở trên `127.0.0.1` trong bản prod, truy cập qua SSH tunnel hoặc Reverse Proxy):**
  - Grafana Dashboards: `http://127.0.0.1:3001`
  - Prometheus & Alerts: `http://127.0.0.1:9090` (`/targets`, `/alerts`)
  - Alertmanager: `http://127.0.0.1:9094`
  - Jaeger Tracing: `http://127.0.0.1:16686`

---

## 2. QUY TRÌNH XỬ LÝ SỰ CỐ (SOP) THEO ALERT RULES

### 2.1 `ServiceDown` (`severity: critical`)
- **Nguyên nhân thường gặp:** Container crash/OOM, mất kết nối DB/Redis/Kafka khi khởi động, hoặc cổng metrics bị chiếm.
- **Các bước xử lý:**
  1. Kiểm tra trạng thái container: `docker compose -f docker-compose.prod.yml --env-file .env.production.local ps`
  2. Xem 100 dòng log cuối: `docker compose -f docker-compose.prod.yml --env-file .env.production.local logs --tail=100 <service>`
  3. Kiểm tra endpoint `/ready` để xác định dependency nào đang `down`.
  4. Nếu OOMKilled (`Exit 137`), kiểm tra dashboard RAM và tăng `deploy.resources.limits.memory` hoặc tìm memory leak.

### 2.2 `HighMemoryUsage` (`severity: warning`)
- **Nguyên nhân:** Bộ nhớ RSS vượt ngưỡng 85% định mức (450MB cho NestJS / 1.7GB cho `ai-chatbot-service`).
- **Các bước xử lý:**
  1. Mở dashboard **SE121 Microservices System & Golden Signals** xem xu hướng tăng RAM (spike nhất thời hay tăng tuyến tính leak).
  2. Nếu là `ai-chatbot-service`, kiểm tra kích thước batch ảnh VLM hoặc cache HuggingFace/PyTorch.
  3. Khởi động lại có kiểm soát (graceful shutdown): `docker compose -f docker-compose.prod.yml --env-file .env.production.local restart <service>`.

### 2.3 `HighHttpErrorRate` (`severity: critical`, 5xx > 1%)
- **Nguyên nhân:** Downstream TCP service chết, DB timeout (`504 Gateway Timeout`), hoặc lỗi code chưa bắt exception.
- **Các bước xử lý:**
  1. Mở dashboard **SE121 Messaging, DLQ & Logs** → lọc panel **Error Logs Stream (Loki)** với `level="error"`.
  2. Copy `traceId` từ dòng log lỗi → bấm link **TraceID (Jaeger)** để xác định span nào trả lỗi đầu tiên.
  3. Kiểm tra `/api/v1/ready` xem có DB/Redis nào bị mất kết nối không.

### 2.4 `HighGatewayLatencyP95` (`severity: warning`, P95 > 300ms)
- **Nguyên nhân:** Truy vấn DB thiếu index, Redis cache miss hàng loạt, hoặc một service hạ nguồn chậm kéo nghẽn Gateway.
- **Các bước xử lý:**
  1. Mở **Microservice RPC Latency P95** trên dashboard **System & Golden Signals** để khoanh vùng service nào chậm.
  2. Mở Jaeger tìm các trace có `Duration > 300ms` để xem span cụ thể (DB query, Redis, hay RPC).
  3. Kiểm tra `nodejs_eventloop_lag_seconds` xem có tác vụ đồng bộ CPU-bound chặn Event Loop không.

### 2.5 `HighVlmOrChatbotLatency` (`severity: warning`, P95 > 2.5s)
- **Nguyên nhân:** API Groq/Gemini (VLM) bên thứ 3 phản hồi chậm hoặc ảnh tải về quá lớn.
- **Các bước xử lý:**
  1. Mở dashboard **SE121 AI, VLM & Mental Health Pipeline** kiểm tra `VLM P95`, `Chatbot P95`, `Empty Replies`, `Truncations`.
  2. Kiểm tra log `ai-chatbot-service` xem có retry/rate-limit từ nhà cung cấp LLM/VLM (429/503) hay không.
  3. Xác nhận Circuit Breaker (`music-analyze-ai`) và `GATEWAY_AI_TIMEOUT_MS` đang bảo vệ Gateway không bị treo kết nối.

### 2.6 `KafkaDlqMessageDetected` (`severity: warning`)
- **Nguyên nhân:** Consumer xử lý thất bại sau hết số lần retry (lỗi schema, DB constraint, hoặc downstream chết).
- **Các bước xử lý:**
  1. Kiểm tra danh sách message lỗi bằng công cụ DLQ:
     ```bash
     KAFKA_BROKERS=localhost:9092 npm run dlq:tool -- list <topic>
     ```
  2. Khắc phục nguyên nhân gốc gây lỗi ở consumer hoặc dữ liệu.
  3. Đẩy lại (replay) message từ DLQ về topic gốc:
     ```bash
     KAFKA_BROKERS=localhost:9092 npm run dlq:tool -- replay <topic> --limit 50
     ```

---

## 3. SAO LƯU & PHỤC HỒI DỮ LIỆU (BACKUP & RESTORE)

### 3.1 PostgreSQL (`pg_dump`)
```bash
# Backup
pg_dump "$DATABASE_URL" -Fc -f "backup_pg_$(date +%Y%m%d_%H%M%S).dump"
# Restore
pg_restore -d "$DATABASE_URL" --clean --if-exists backup_pg_YYYYMMDD_HHMMSS.dump
```

### 3.2 MongoDB (`mongodump`)
```bash
# Backup
mongodump --uri="$MONGODB_URI" --archive="backup_mongo_$(date +%Y%m%d_%H%M%S).gz" --gzip
# Restore
mongorestore --uri="$MONGODB_URI" --archive="backup_mongo_YYYYMMDD_HHMMSS.gz" --gzip --drop
```

### 3.3 Elasticsearch Snapshot (RAG & Search Indices)
- Đăng ký snapshot repository (`fs` hoặc `s3`) và gọi API tạo snapshot định kỳ qua `PUT /_snapshot/se121_backup/snap_$(date +%Y%m%d)?wait_for_completion=true`.
