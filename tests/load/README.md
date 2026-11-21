# 🎯 BỘ KỊCH BẢN KIỂM THỬ CHỊU TẢI TOÀN DIỆN (SYSTEM LOAD TESTING SUITE)
> **Dự án:** Mạng xã hội Tích hợp AI Hỗ trợ Chăm sóc Sức khỏe Tinh thần (`SE121-microservices`)  
> **Căn cứ kế hoạch:** [ke_hoach_kiem_thu_tai_load_test_toan_dien.md](file:///d:/VsCode/NestJS/projects/SE121-microservices/docs/outputs/bao_cao_lan_6/ke_hoach_kiem_thu_tai_load_test_toan_dien.md)  
> **Môi trường thực thi:** [`docker-compose.test.yml`](file:///d:/VsCode/NestJS/projects/SE121-microservices/docker-compose.test.yml) (Áp đặt hạn mức tài nguyên cgroups: 4 vCPU, 8–16GB RAM)  
> **Công cụ tạo tải:** [Grafana k6](https://k6.io/) (Containerized Runner 1.5 vCPU, 512MB RAM)  

---

## 📑 MỤC LỤC
1. [Tổng quan ma trận 6 kịch bản kiểm thử](#1-tổng-quan-ma-trận-6-kịch-bản-kiểm-thử)
2. [Cơ chế hoạt động & Môi trường thử nghiệm](#2-cơ-chế-hoạt-động--môi-trường-thử-nghiệm)
3. [Hướng dẫn chạy kiểm thử nhanh (Quick Start)](#3-hướng-dẫn-chạy-kiểm-thử-nhanh-quick-start)
4. [Hướng dẫn chạy riêng lẻ từng kịch bản (Individual Execution)](#4-hướng-dẫn-chạy-riêng-lẻ-từng-kịch-bản-individual-execution)
5. [Hướng dẫn chạy kịch bản hỗn hợp toàn diện (Blended Workload)](#5-hướng-dẫn-chạy-kịch-bản-hỗn-hợp-toàn-diện-blended-workload)
6. [Bảng tra cứu tham số lệnh `run-k6-docker.ps1`](#6-bảng-tra-cứu-tham-số-lệnh-run-k6-dockerps1)
7. [Quản lý và giải mã kết quả kiểm thử (`tests/load/results/`)](#7-quản-lý-và-giải-mã-kết-quả-kiểm-thử-testsloadresults)
8. [Đối soát chỉ tiêu chất lượng dịch vụ (SLO Verification)](#8-đối-soát-chỉ-tiêu-chất-lượng-dịch-vụ-slo-verification)

---

## 1. TỔNG QUAN MA TRẬN 6 KỊCH BẢN KIỂM THỬ

Toàn bộ hệ thống kiểm thử tải được cấu trúc thành **6 kịch bản chuyên sâu** và **1 kịch bản tổng hợp hỗn hợp** bao phủ trọn vẹn 7 microservices:

| Mã Kịch Bản | Tên Kịch Bản & File Thực Thi | Phân Hệ Mục Tiêu | Loại Tác Vụ | Cam Kết Đề Cương / SLO Mục Tiêu |
| :--- | :--- | :--- | :---: | :--- |
| **LT-01.1** | [`k6-feed-session-loadtest.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-feed-session-loadtest.js) | Personal Newsfeed & Emotion Ranking | Đọc / Cache | **200 – 400 RPS**, P95 < 300 ms, Duplicate = 0.0000% |
| **LT-01.2** | [`k6-trending-session-loadtest.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-trending-session-loadtest.js) | Global Trending Feed & ZSET Cache | Đọc / Cache | **200 – 400 RPS**, P95 < 300 ms, Duplicate = 0.0000% |
| **LT-02** | [`k6-post-fanout-stress.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-post-fanout-stress.js) | Post Ingestion & Kafka Event Fan-Out | Ghi (Write) | **50 – 100 RPS**, Gateway P95 < 300 ms, Error < 1% |
| **LT-03** | [`k6-social-interaction-loadtest.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-social-interaction-loadtest.js) | 7-Emotion Reactions & Comments | Tương tác cao tần | **150 – 250 RPS**, P95 < 250 ms, Zero Write Lock |
| **LT-04** | [`k6-ai-assistant-rag-loadtest.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-ai-assistant-rag-loadtest.js) | AI Safe Space Chatbot & Crisis Guard | Trí tuệ nhân tạo | Crisis Interrupt P95 < 150 ms, RAG LLM P95 < 2.5s |
| **LT-05** | [`k6-music-search-loadtest.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-music-search-loadtest.js) | Gợi ý nhạc Iso-principle & Elasticsearch | Tìm kiếm & AI | **80 – 150 RPS**, P95 < 250 ms |
| **LT-06** | [`k6-blended-realistic-workload.js`](file:///d:/VsCode/NestJS/projects/SE121-microservices/tests/load/k6-blended-realistic-workload.js) | Kịch bản Tải Hỗn Hợp (70:15:10:5) | Toàn diện (E2E) | **200 – 400 RPS**, Tổng thể P95 < 300 ms, Error < 1% |

---

## 2. CƠ CHẾ HOẠT ĐỘNG & MÔI TRƯỜNG THỬ NGHIỆM

### 2.1 Kiến trúc Môi trường Thử nghiệm Cô lập
* Toàn bộ 7 microservices, 7 cơ sở dữ liệu / message broker và container K6 runner được triển khai độc lập thông qua file [`docker-compose.test.yml`](file:///d:/VsCode/NestJS/projects/SE121-microservices/docker-compose.test.yml).
* Hạn ngạch tài nguyên CPU/RAM được kiểm soát chặt chẽ bằng Docker cgroups, tổng dung lượng tiêu thụ luôn nằm dưới ngưỡng **4 vCPU và 8–16GB RAM** theo đúng cam kết trong Đề cương KLTN.

### 2.2 Các cơ chế tăng tốc & vượt rào cản kiểm thử (`ENABLE_LOAD_TEST_MODE=true`)
1. **Bypass Clerk Auth:** Giả lập xác thực người dùng ảo thông qua header `x-mock-user-id: load_user_X` và token `Bearer mock_user_load_user_X`. Điều này giúp bài test chạy hoàn toàn độc lập, không tiêu tốn quota của dịch vụ bên ngoài và không bị ảnh hưởng bởi độ trễ mạng internet.
2. **Bypass Throttler:** Loại bỏ giới hạn rate limit thông thường (60 req/phút) để k6 đẩy lưu lượng lên hàng trăm request/giây.
3. **Giám sát tự động (Docker Stats Monitor Daemon):** Script PowerShell tự động kích hoạt một job nền ngầm ghi nhận mẫu CPU%, RAM%, Peak Mem của toàn bộ container mỗi 2.5 giây, sau đó xuất báo cáo tổng hợp JSON và tự động dọn sạch file tạm.

---

## 3. HƯỚNG DẪN CHẠY KIỂM THỬ NHANH (QUICK START)

Trước khi chạy kiểm thử, đảm bảo hạ tầng test đã được khởi động và nạp dữ liệu mồi:

```powershell
# Bước 1: Khởi động toàn bộ cụm hạ tầng test trong nền
docker compose -f docker-compose.test.yml up -d

# Bước 2: Nạp dữ liệu giả lập cho người dùng ảo và bài viết (nếu chạy lần đầu)
npm run seed:loadtest

# Bước 3: Chạy thử nhanh kiểm tra thông suốt (Smoke Test - 10 VUs trong 16s)
.\tests\load\run-k6-docker.ps1 -Compose -Smoke
```

---

## 4. HƯỚNG DẪN CHẠY RIÊNG LẺ TỪNG KỊCH BẢN (INDIVIDUAL EXECUTION)

Bạn có thể chạy riêng lẻ từng kịch bản thông qua tham số `-Scenario` (hoặc `-TestScript`):

### 4.1. Kịch bản LT-01.1: Bảng tin cá nhân hóa (Personal Newsfeed)
Kiểm tra luồng đọc bảng tin riêng của từng user, tính toán vector cảm xúc EMA và phân trang cursor Redis:
```powershell
# Chạy tiêu chuẩn (200 VUs, duy trì 6 phút, Pacing nhanh để đo Throughput cực đại)
.\tests\load\run-k6-docker.ps1 -Compose -Scenario feed -Profile sustained -Pacing fast

# Kết quả lưu tại:
# - tests/load/results/summary-sustained.json
# - tests/load/results/docker-resource-usage-sustained.json
```

### 4.2. Kịch bản LT-01.2: Bảng tin thịnh hành (Trending Feed)
Kiểm tra luồng đọc bảng tin thịnh hành chung của toàn hệ sinh thái từ Redis cache:
```powershell
.\tests\load\run-k6-docker.ps1 -Compose -Scenario trending -Profile sustained -Pacing fast

# Kết quả lưu tại:
# - tests/load/results/summary-trending-sustained.json
# - tests/load/results/docker-resource-usage-trending-sustained.json
```

### 4.3. Kịch bản LT-02: Tác vụ Ghi bài viết mới & Fan-Out Kafka (Write Ingestion)
Kiểm tra khả năng chịu tải của cổng tiếp nhận bài viết, phát sự kiện bất đồng bộ qua Kafka (Cam kết Đề cương: 50 – 100 RPS):
```powershell
# Chạy bài test ghi ở mức tải 80 VUs liên tục
.\tests\load\run-k6-docker.ps1 -Compose -Scenario write -Profile sustained -VUs 80

# Kết quả lưu tại:
# - tests/load/results/summary-write-sustained.json
# - tests/load/results/docker-resource-usage-write-sustained.json
```

### 4.4. Kịch bản LT-03: Tương tác Xã hội Cao tần (Reactions & Comments)
Mô phỏng người dùng thả reaction theo 7 cảm xúc cơ bản và gửi bình luận tương tác:
```powershell
.\tests\load\run-k6-docker.ps1 -Compose -Scenario interaction -Profile standard -VUs 100

# Kết quả lưu tại:
# - tests/load/results/summary-interaction-standard.json
# - tests/load/results/docker-resource-usage-interaction-standard.json
```

### 4.5. Kịch bản LT-04: Trợ lý AI Safe Space & Ngắt Khủng hoảng (Crisis Guard)
Kiểm tra nhánh ngắt khẩn cấp (< 100ms) khi phát hiện từ khóa nguy hiểm và luồng RAG tư vấn tâm lý:
```powershell
.\tests\load\run-k6-docker.ps1 -Compose -Scenario ai -Profile standard -VUs 40

# Kết quả lưu tại:
# - tests/load/results/summary-ai-standard.json
# - tests/load/results/docker-resource-usage-ai-standard.json
```

### 4.6. Kịch bản LT-05: Gợi ý Âm nhạc Điều hòa & Tìm kiếm Toàn văn (Music & Search)
Kiểm tra truy vấn pgvector trên PostgreSQL và full-text search tiếng Việt trên Elasticsearch 9:
```powershell
.\tests\load\run-k6-docker.ps1 -Compose -Scenario music -Profile standard -VUs 80

# Kết quả lưu tại:
# - tests/load/results/summary-music-search-standard.json
# - tests/load/results/docker-resource-usage-music-search-standard.json
```

---

## 5. HƯỚNG DẪN CHẠY KỊCH BẢN HỖN HỢP TOÀN DIỆN (BLENDED WORKLOAD)

Kịch bản **LT-06 (Blended Realistic Workload)** là bài kiểm thử mô phỏng chân thực nhất một ngày hoạt động cao điểm của mạng xã hội sinh viên, kết hợp tất cả các luồng nghiệp vụ theo phân bổ xác suất thực tế:
* **70% Lưu lượng:** Lướt xem Newsfeed & Trending (`my-feed`, `trending`).
* **15% Lưu lượng:** Tương tác cảm xúc và bình luận bài viết (`reactions`, `comments`).
* **10% Lưu lượng:** Đăng bài viết trạng thái mới (`posts` write ingestion).
* **5% Lưu lượng:** Trò chuyện với Trợ lý AI và tìm kiếm âm nhạc (`assistant`, `musics`).

```powershell
# Chạy kịch bản hỗn hợp 200 Virtual Users duy trì trong 6 phút
.\tests\load\run-k6-docker.ps1 -Compose -Scenario blended -Profile sustained -VUs 200

# Kết quả lưu tại:
# - tests/load/results/summary-blended-sustained.json
# - tests/load/results/docker-resource-usage-blended-sustained.json
```

---

## 6. BẢNG TRA CỨU THAM SỐ LỆNH `run-k6-docker.ps1`

| Tham Số | Kiểu Dữ Liệu | Giá Trị Mặc Định | Mô Tả Chức Năng |
| :--- | :---: | :---: | :--- |
| `-Scenario` | String | `"feed"` | Tên kịch bản viết tắt: `feed`, `trending`, `write`, `interaction`, `ai`, `music`, `blended`. |
| `-TestScript`| String | `"k6-feed-session-loadtest.js"` | Tên file script k6 cụ thể trong thư mục `tests/load/`. |
| `-Profile` | String | `"sustained"` | Hồ sơ tải: `smoke` (16s), `standard` (2m30s), `sustained` (6m), `stress` (4m). |
| `-Pacing` | String | `"realistic"` | Tốc độ lướt tin: `fast` (~0.7s - đo đỉnh Throughput), `realistic` (1.2-2.0s), `relaxed` (2.5-4.5s). |
| `-VUs` | Integer | `200` | Số lượng Virtual Users đồng thời tối đa trong bài test. |
| `-Compose` | Switch | `$false` | Bắt buộc truyền cờ này để chạy k6 trực tiếp trong mạng Docker test cô lập. |
| `-Build` | Switch | `$false` | Tự động rebuild `api-gateway` và `content-feed-service` trước khi bắn tải. |
| `-Smoke` | Switch | `$false` | Chạy nhanh 10 VUs trong 16s để xác thực kịch bản không bị lỗi cú pháp. |
| `-KeepRawStats`| Switch | `$false` | Giữ lại file log CSV thô `raw_docker_stats.csv` để nghiên cứu sâu. |

---

## 7. QUẢN LÝ VÀ GIẢI MÃ KẾT QUẢ KIỂM THỬ (`tests/load/results/`)

Thư mục `tests/load/results/` được cấu hình tự động lưu trữ định lượng có phân biệt tiền tố (tagging) để các bài test sau **không bao giờ ghi đè mất dữ liệu đối chứng của các bài test trước**:

```text
tests/load/results/
├── summary.json                                 # Kết quả k6 của lần chạy gần nhất
├── docker-resource-usage.json                   # Mức CPU/RAM của lần chạy gần nhất
├── summary-sustained.json                       # Kết quả chính thức Newsfeed 200 VUs
├── docker-resource-usage-sustained.json         # Mức CPU/RAM Newsfeed 200 VUs
├── summary-trending-sustained.json              # Kết quả bài Trending Feed
├── summary-write-sustained.json                 # Kết quả bài Ghi bài viết mới
├── summary-blended-sustained.json               # Kết quả bài Tải hỗn hợp thực tế
└── ...
```

---

## 8. ĐỐI SOÁT CHỈ TIÊU CHẤT LƯỢNG DỊCH VỤ (SLO VERIFICATION)

Mọi kết quả kiểm thử tải được coi là **Hợp Lệ và Đạt Chuẩn Nghiệm Thu Khóa Luận Tốt Nghiệp** khi thỏa mãn đồng thời các điều kiện sau trong file `summary-*.json`:

1. **Thông lượng (Throughput):**
   * Tác vụ đọc (Feed/Trending): $\ge 200 \text{ req/s}$ (Dải cam kết: $200 – 400 \text{ req/s}$).
   * Tác vụ ghi (Post Write): $\ge 50 \text{ req/s}$ (Dải cam kết: $50 – 100 \text{ req/s}$).
2. **Độ trễ phân vị 95% (Latency P95):**
   * $\text{P95} < 300 \text{ ms}$ trên toàn bộ các yêu cầu HTTP đọc/ghi.
   * Ngắt khủng hoảng AI: $\text{P95} < 150 \text{ ms}$.
3. **Độ tin cậy và Tính toàn vẹn:**
   * Tỷ lệ yêu cầu thất bại: $\text{Error Rate} < 1.0\%$ (Kỳ vọng: $0.00\%$).
   * Tỷ lệ bài viết trùng lặp phiên lướt tin: $\text{Duplicate Rate} = 0.0000\%$.
4. **Độ bền bỉ phần cứng (Hardware Stability):**
   * Không có container nào bị OOM-Killed (Exit code 137).
   * Mức chiếm dụng RAM duy trì ổn định, độ lệch giữa `Peak Mem %` và `Avg Mem %` dưới $2\%$ khẳng định **Zero Memory Leak**.
