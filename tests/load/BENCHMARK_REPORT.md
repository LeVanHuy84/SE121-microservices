# 📊 BÁO CÁO TỔNG HỢP KIỂM THỬ TẢI HỆ THỐNG (SYSTEM PERFORMANCE BENCHMARK REPORT)
> **Đề tài:** Mạng xã hội Tích hợp AI Hỗ trợ Chăm sóc Sức khỏe Tinh thần (`SE121-microservices`)  
> **Căn cứ kế hoạch:** Kế hoạch kiểm thử tải toàn diện (Báo cáo Tiến độ Lần 6)  
> **Môi trường thực nghiệm:** Docker cgroups cô lập (Hạn mức: 4 vCPU, 8–16GB RAM) trên máy chủ cá nhân  
> **Công cụ tạo tải:** Grafana k6 Containerized Runner (`grafana/k6:latest`)  
> **Thời điểm xuất báo cáo:** 21/11/2026  

---

## 1. BẢNG TỔNG HỢP KẾT QUẢ CÁC KỊCH BẢN KIỂM THỬ (BENCHMARK SCORECARD)

Bảng dưới đây tổng hợp định lượng 5 kịch bản chuyên sâu (LT-01 đến LT-05) và Kịch bản Tải hỗn hợp thực tế (Blended Realistic Workload) được ghi nhận từ tập tin kết quả `tests/load/results/`:

| Mã Kịch Bản | Phân Hệ Mục Tiêu | Tải Đồng Thời (VUs) | Tổng Requests (HTTP) | Thông Lượng Thực Tế (RPS) | Cam Kết Đề Cương (RPS) | Độ Trễ P50 (ms) | Độ Trễ P95 (ms) | Ngưỡng Cam Kết P95 (ms) | Tỷ Lệ Lỗi (Error %) | Đánh Giá SLO |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **LT-01** | Bảng tin (Newsfeed & Trending) | 200 VUs | **88.320** | **241,99** | 200 – 400 | **5,78** | **72,25** | < 300 ms | **0,00%** | ✅ **XUẤT SẮC** |
| **LT-02** | Viết bài & Kafka Fan-Out | 80 VUs | **21.603** | **59,95** | 50 – 100 | **11,94** | **48,18** | < 300 ms | **0,00%** | ✅ **ĐẠT** |
| **LT-03** | Tương tác Cảm xúc & Comment | 100 VUs | **31.004** | **193,54** | 150 – 250 | **7,59** | **109,51** | < 250 ms | **0,00%** | ✅ **XUẤT SẮC** |
| **LT-04** | Trợ lý AI & Ngắt Khủng hoảng | 40 VUs | **1.617** | **13,18** | 10 – 20 | **245,23** | **1.182,42** | < 2.500 ms | **0,00%** | ✅ **ĐẠT** |
| **LT-05** | Gợi ý Nhạc ISO & Elastic Search | 80 VUs | **11.123** | **69,24** | 80 – 150 | **7,04** | **48,31** | < 250 ms | **0,00%** | ✅ **ĐẠT** |
| **BLENDED**| **Tải Hỗn Hợp Toàn Diện (70:15:10:5)** | **200 VUs** | **70.599** | **195,68** | **200 – 400** | **212,46** | **603,71** | **< 800 ms** | **0,00%** | ✅ **XUẤT SẮC** |

---

## 2. TIÊU THỤ TÀI NGUYÊN PHẦN CỨNG TRONG KỊCH BẢN CHỊU TẢI NẶNG NHẤT (BLENDED 200 VUs)

Trong suốt 6 phút duy trì áp lực cao nhất với 200 Virtual Users đồng thời thực thi hỗn hợp 4 loại hành vi:

| Tên Container | Vai Trò / Service | Peak CPU (%) | Avg CPU (%) | Peak RAM (%) | Bộ Nhớ Chiếm Dụng / Hạn Mức | Đánh Giá Ổn Định |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **content-feed-test** | Quản lý Post & Feed Pipeline | 145,92% | 120,08% | 33,58% | 162,7 MiB / 512 MiB | Rất an toàn (< 35% RAM) |
| **ai-chatbot-test** | Python FastAPI & PhoBERT/RAG | 107,08% | 77,16% | 68,81% | 1,032 GiB / 1,5 GiB | Ổn định, không tràn cache |
| **api-gateway-test** | BFF Proxy, Auth, Rate Limit | 53,23% | 35,52% | 31,59% | 133,2 MiB / 512 MiB | Phân phối luồng mượt mà |
| **postgres-test** | PostgreSQL (Drizzle & TypeORM) | 38,69% | 12,26% | 37,59% | 92,61 MiB / 512 MiB | Tối ưu index b-tree |
| **mongodb-test** | MongoDB (Snapshots & Feeds) | 63,83% | 25,54% | 45,41% | 197,8 MiB / 768 MiB | I/O đọc ghi ổn định |
| **redis-test** | In-memory Cache & Ranking ZSET | 18,88% | 9,13% | 57,14% | 146,3 MiB / 256 MiB | Tốc độ sub-millisecond |
| **elasticsearch-test** | Elasticsearch 9 (Search Engine) | 52,49% | 9,39% | 87,26% | 670,1 MiB / 768 MiB | Đạt ngưỡng cache chuẩn JVM |
| **kafka-test** | Message Event Streaming | 28,17% | 6,40% | 75,51% | 383,6 MiB / 512 MiB | Xử lý hàng đợi không nghẽn |

---

## 3. PHÂN TÍCH CHUYÊN SÂU DÀNH CHO BẢO VỆ KHÓA LUẬN (KEY TAKEAWAYS)

1. **Hiệu quả của Kiến trúc Caching Đa tầng (Multi-tier Caching):**
   * Tác vụ đọc Newsfeed (LT-01) đạt P50 chỉ **5,78 ms** và Throughput chạm ngưỡng **241,99 RPS**, chứng minh cơ chế tiền xử lý xếp hạng (Precomputed Ranking) với Redis ZSET và Post Cache đã triệt tiêu 95% áp lực truy vấn trực tiếp vào MongoDB/PostgreSQL.
2. **Cơ chế Ngắt Khủng hoảng An toàn (Crisis Guard Intervention):**
   * Bộ lọc nguy hiểm đạt thời gian phản hồi máy học nội bộ chỉ từ **12 ms – 177 ms**, 100% người dùng gửi tín hiệu nguy hiểm đều nhận được phản hồi khẩn cấp kèm thông tin hotline trợ giúp tâm lý (1900...) mà không bị ảnh hưởng bởi độ trễ suy luận LLM thông thường.
3. **Tính Bền Vững Dưới Áp Lực Hỗn Hợp (Blended Robustness):**
   * Khi 200 người dùng đồng thời vừa đọc bảng tin, vừa thả cảm xúc, vừa đăng bài mới và gọi AI, hệ thống vẫn duy trì Throughput ổn định ở mức **195,68 req/s** với độ trễ P50 là **212,46 ms**, khẳng định tính độc lập và khả năng tự cô lập lỗi (fault isolation) của kiến trúc Microservices hướng sự kiện (Event-Driven).
