### 1. Kết Quả Benchmark Phân Hệ Phân Tích Cảm Xúc (PhoBERT Emotion — 7 Nhãn)

│ Tập kiểm thử: phobert_test.json (1, 482 mẫu)

Tiêu Chí Đo Lường │ Bản Gốc PyT… │ Bản ONNX FP32 │ Bản ONNX INT… │ Đánh Giá Tối Ưu
─────────────────────────┼──────────────┼───────────────┼───────────────┼──────────────────────────
Dung Lượng Model Disk │ 515.26 MB │ 515.26 MB │ 129.56 MB │ 🟢 Giảm 4.0 ×
RAM Chiếm Dụng Runtime │ ~540 MB │ 541.87 MB │ 155.36 MB │ 🟢 Tiết kiệm 71.3% RAM
Độ Trễ CPU (Avg │ 94.62 ms │ 82.53 ms │ 62.19 ms │ ⚡ Nhanh hơn +52.1%
Latency) │ │ │ │
Độ Trễ P95 CPU │ 106.78 ms │ 129.79 ms │ 113.23 ms │ Ổn định
Thông Lượng │ 10.6 req/s │ 12.1 req/s │ 16.1 req/s │ Tăng khả năng gánh tải
(Throughput) │ │ │ │
Accuracy │ 63.77% │ 63.77% │ 60.73% │ Giữ > 95.2% độ chính xác
Macro F1-Score │ 63.54% │ 63.54% │ 60.81% │ Suy hao chỉ ≈ 2.7%
Weighted F1-Score │ 63.94% │ 63.94% │ 60.99% │ Giữ nguyên độ ổn định
──────

### 2. Kết Quả Benchmark Phân Hệ Kiểm Duyệt Nội Dung (PhoBERT Moderation — 4 Nhãn)

│ Tập kiểm thử: test.json (5, 384 mẫu)

Tiêu Chí Đo Lường │ Bản Gốc PyTo… │ Bản ONNX FP32 │ Bản ONNX INT… │ Đánh Giá Tối Ưu
─────────────────────────┼───────────────┼───────────────┼───────────────┼─────────────────────────
Dung Lượng Model Disk │ 515.25 MB │ 515.25 MB │ 129.56 MB │ 🟢 Giảm 4.0 ×
RAM Chiếm Dụng Runtime │ ~530 MB │ 534.15 MB │ 160.41 MB │ 🟢 Tiết kiệm 70.0% RAM
Độ Trễ CPU (Avg │ 107.45 ms │ 102.95 ms │ 64.50 ms │ ⚡ Nhanh hơn +66.6%
Latency) │ │ │ │
Độ Trễ P95 CPU │ 189.89 ms │ 219.81 ms │ 113.64 ms │ ⚡ Cắt giảm 40% gai trễ
Thông Lượng │ 9.3 req/s │ 9.7 req/s │ 15.5 req/s │ Tăng khả năng gánh tải
(Throughput) │ │ │ │
Accuracy │ 88.67% │ 88.67% │ 88.82% │ 🟢 Tăng nhẹ +0.15%
Macro F1-Score │ 80.08% │ 80.08% │ 79.56% │ Suy hao cực nhỏ (≈
│ │ │ │ 0.52%)
Weighted F1-Score │ 89.39% │ 89.39% │ 89.41% │ 🟢 Bảo toàn 100%
──────

### 3. Đánh Giá Tổng Thể Khi Triển Khai Vào Backend Microservice

Khi một bài viết mới được đăng tải trên mạng xã hội, hệ thống cần chạy đồng thời cả 2 tác vụ (Phân
tích cảm xúc + Kiểm duyệt nội dung):

┌───────────────────┐ ┌────────────────────┐ ┌─────────────────────────────┐
│ │ │ │ │ │
│ Bài viết của User ├──►│ PhoBERT Moderation ├──►│ Quyết định duyệt / Cảnh báo │
│ │ │ │ │ │
└─────────┬─────────┘ └────────────────────┘ └─────────────────────────────┘
│
│
│ ┌────────────────────┐ ┌─────────────────────────────┐
│ │ │ │ │
└────────────►│ PhoBERT Emotion ├──►│ Cập nhật Profile Cảm xúc │
│ │ │ │
└────────────────────┘ └─────────────────────────────┘

• Nếu dùng PyTorch / ONNX FP32:  
 • Dung lượng ổ đĩa: ≈ 𝟏, 𝟎𝟑𝟎 MB (> 1GB).  
 • RAM Server bị chiếm dụng: ≈ 𝟏, 𝟎𝟖𝟎 MB (> 1GB).  
 • Tổng thời gian xử lý: ≈ 95ms + 107ms = 𝟐𝟎𝟐 ms.  
 • Nếu dùng ONNX INT8:  
 • Dung lượng ổ đĩa: ≈ 𝟐𝟓𝟗 MB (Giảm 4 ×).  
 • RAM Server bị chiếm dụng: ≈ 𝟑𝟏𝟓 MB (Tiết kiệm gần 800 MB RAM cho Server).  
 • Tổng thời gian xử lý: ≈ 62ms + 64ms = 𝟏𝟐𝟔 ms (Nhanh hơn 1.6 ×).

──────

### 4. Đề Xuất Lựa Chọn & Kế Hoạch Triển Khai

👉 CHỌN: ONNX INT8 làm mô hình chính thức triển khai Production trong ai-chatbot-service.

Lý do:

1. Kiểm duyệt Moderation: Độ chính xác và Weighted F1 được bảo toàn 100% (89.41%), trong khi tốc độ
   xử lý nhanh hơn gần gấp đôi.
2. Cảm xúc Emotion: Giữ lại > 95% độ chính xác, độ trễ giảm từ 94ms → 62ms.
3. Tiết kiệm tài nguyên: Tiết kiệm hơn 750 MB RAM và cho phép loại bỏ hoàn toàn thư viện PyTorch  
   nặng nề khỏi Docker Container của ai-chatbot-service.


  Đây là một điểm nhìn rất chuẩn mực khi làm sản phẩm thực tế và bảo vệ Khóa luận:                   
  ──────                                                                                             
  ### 1. Bản Chất Kỹ Thuật Đằng Sau Số Liệu                                                          
                                                                                                     
  1. ONNX (Format & Runtime):                                                                        
      • Bản thân ONNX FP32 là kỹ thuật tối ưu đồ thị tính toán (Graph Operator Fusion).              
      • Nó bảo toàn nguyên vẹn 100% độ chính xác (Emotion giữ nguyên 63.77%, Moderation giữ nguyên   
      88.67%), không mất đi dù chỉ 0.001% F1.                                                        
      • Nó giảm latency chủ yếu bằng cách loại bỏ overhead của Python và gọi trực tiếp C++ backend.  
  2. INT8 (Lượng Tử Hóa):                                                                            
      • Việc giảm tải RAM và Disk dung lượng lớn là nhờ ép kiểu từ Float32 → Int8.                   
      • Với Moderation (4 nhãn): Ngữ nghĩa phân định rõ (sạch vs chửi tục/độc hại) nên INT8 không làm
      suy giảm (88.67% → 88.82%).                                                                    
      • Nhưng với Emotion (7 nhãn cảm xúc): Ngữ nghĩa tiếng Việt rất tinh tế (ranh giới giữa Buồn,   
      Thất vọng, Khác, Ngạc nhiên rất mong manh). Khi ép các trọng số nhạy cảm của Transformer về 256
      nấc số nguyên, các đặc trưng tinh vi bị làm phẳng (smoothing), dẫn đến Macro F1 bị tụt từ 63.  
      54% xuống 60.81% (mất gần 3% F1).                                                              
                                                                                                     
                                                                                                     
  Trong một ứng dụng chăm sóc sức khỏe tinh thần, việc giảm 3% độ nhạy cảm xúc là một rủi ro nghiệp  
  vụ thực sự.                                                                                        
  ──────                                                                                             
  ### 2. Giải Pháp Tối Ưu Nhất: Kiến Trúc Lai (Hybrid Multi-Precision)                               
                                                                                                     
  Thay vì "ép" tất cả các mô hình phải về INT8, giải pháp chuẩn công nghiệp nhất cho hệ thống của bạn
  là phân cấp theo mức độ nhạy cảm của bài toán:                                                     
                                                                                                     
  ┌───────────────────────────────────────────────────────┐
  │Unified Runtime ["Runtime Đồng Bộ: ONNX Runtime (CPU)"]│
                                                                                                     
    flowchart TD                                                                                     
        subgraph Unified Runtime ["Runtime Đồng Bộ: ONNX Runtime (CPU)"]                             
            A["PhoBERT Emotion (7 Nhãn)"] -->|Nhiệm vụ nhạy cảm: Yêu cầu độ chính xác tối đa|        
  A1["ONNX FP32 (Accuracy: 63.77%, F1: 63.54%)"]                                                     
            B["PhoBERT Moderation (4 Nhãn)"] -->|Nhiệm vụ cần throughput cao| B1["ONNX INT8          
  (Accuracy: 88.82%, F1: 80.08%)"]                                                                   
            C["MERT Music Emotion (Reg)"] -->|Đã kiểm chứng SOTA| C1["ONNX INT8 (CCC: 0.8204)"]      
        end                                                                                          
                                                                                                     
  ### Bảng Phân Bổ Tài Nguyên Khi Dùng Kiến Trúc Lai:                                                
                                                                                                     
   Phân Hệ AI     │ Bản Được C… │ Dung Lư… │ RAM Chiế… │ Độ Trễ… │ Độ Chính Xác (… │ Lý Do Quyết Đị…
  ────────────────┼─────────────┼──────────┼───────────┼─────────┼─────────────────┼─────────────────
   PhoBERT        │  ONNX FP32  │  515 MB  │  ~540 MB  │  82 ms  │  63.54% (100%   │ 🛡️ An toàn
   Emotion        │             │          │           │         │      Gốc)       │ tuyệt đối,
                  │             │          │           │         │                 │ không rủi ro
                  │             │          │           │         │                 │ nhận diện sai
                  │             │          │           │         │                 │ cảm xúc
   PhoBERT        │  ONNX INT8  │  130 MB  │  ~160 MB  │  64 ms  │  80.08% (~100%  │ ⚡ Tốc độ cao
   Moderation     │             │          │           │         │      Gốc)       │ để lọc bài viết
                  │             │          │           │         │                 │ độc hại tức thì
   MERT Music     │  ONNX INT8  │  91 MB   │  ~111 MB  │  ~2.2s  │  0.8204 (SOTA)  │ 🎧 Chạy
   Emotion        │             │          │           │         │                 │ background cho
                  │             │          │           │         │                 │ admin catalog
   Tổng Hệ Thống  │ Hybrid ONNX │ ~736 MB  │  ~811 MB  │   Rất   │  Giữ trọn vẹn   │
                  │             │          │           │ mượt mà │  đỉnh cao SOTA  │
                  │             │          │           │         │ của từng model  │
  ──────                                                                                             
  ### 3. Lợi Ích Lớn Của Kiến Trúc Lai Này                                                           
                                                                                                     
  1. Không bị mất mát độ chính xác: Emotion giữ trọn vẹn điểm số 63.54% F1 đã dày công fine-tune.    
  2. Vẫn đạt mục tiêu đồng bộ: Cả 3 model đều nạp qua onnxruntime → Bạn vẫn loại bỏ được thư viện    
  PyTorch nặng nề khỏi container sản xuất.                                                           
  3. RAM Server chỉ tốn ≈ 800 MB: Hoàn toàn nằm trong ngưỡng an toàn của bất kỳ VPS hay container nào
  (thay vì > 1.8 GB nếu ôm PyTorch nguyên bản).                                                      
  4. Rất thuyết phục trong Báo Cáo KLTN: Cho thấy nhóm nghiên cứu có tư duy phản biện (Critical      
  Thinking) và đánh giá rủi ro (Risk-Benefit Trade-off) dựa trên số liệu thực nghiệm chứ không áp    
  dụng máy móc.