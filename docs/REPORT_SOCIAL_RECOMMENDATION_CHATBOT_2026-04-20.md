# Báo Cáo Cập Nhật Hệ Thống Social - Recommendation - Chatbot

Ngày cập nhật: 2026-04-20  
Phạm vi: `social-service`, `recommendation-service`, `chatbot-service`

## 1. Mục tiêu báo cáo

Tài liệu này tóm tắt các thay đổi chính theo hướng phục vụ báo cáo nội bộ và nghiệm thu release, tập trung vào:
- Những gì đã thay đổi ở từng service.
- Sự chuyển dịch kiến trúc và trung tâm logic.
- Tác động nghiệp vụ và tác động vận hành.
- Rủi ro cần theo dõi sau triển khai.
- Checklist kiểm thử trước khi đưa vào chạy ổn định.

## 2. Tóm tắt điều hành

Trong đợt cập nhật này, hệ thống đã được điều chỉnh theo hướng **rõ trách nhiệm giữa các service** và **tăng quyết định tại thời điểm truy vấn (runtime)**:

- Recommendation chuyển trọng tâm từ pipeline precompute sang runtime query + ranking.
- Social thu gọn vai trò về nghiệp vụ social graph, giảm logic recommendation nội bộ.
- Chatbot được nâng cấp thành lớp trợ lý sản phẩm có ngữ cảnh, có bộ nhớ ngắn hạn và lịch sử hội thoại bền vững.

Kết quả kỳ vọng:
- Recommendation phản hồi linh hoạt hơn theo dữ liệu mới.
- Social giảm chồng chéo logic, dễ bảo trì hơn.
- Chatbot trả lời nhất quán hơn và có tính liên tục giữa các lượt hỏi đáp.

## 3. Nội dung thay đổi theo service

## 3.1 Recommendation Service

### 3.1.0 Điểm nhấn: chuyển dịch trung tâm logic

Đây là thay đổi cốt lõi của đợt này:
- Trước đây: trọng tâm recommendation nằm nhiều ở xử lý offline/precompute.
- Hiện tại: trọng tâm chuyển sang runtime query, candidate selection và ranking theo ngữ cảnh realtime.

Ý nghĩa:
- Recommendation Service trở thành nơi chịu trách nhiệm chính cho quyết định gợi ý.
- Giảm phụ thuộc vào job nền mới có dữ liệu để phục vụ API.
- Hành vi gợi ý phản ứng nhanh hơn với tín hiệu user mới phát sinh.

### 3.1.1 Điều chỉnh kiến trúc truy vấn

Thay đổi chính:
- Tổ chức lại luồng truy vấn recommendation theo thời gian thực.
- Bổ sung lớp lấy ứng viên và cơ chế fallback toàn cục khi dữ liệu cá nhân hóa chưa đủ.
- Loại bỏ các thành phần precompute không còn phù hợp.

Tác động:
- Giảm độ trễ do chờ pipeline nền.
- Cải thiện phục vụ user mới hoặc user ít tín hiệu hành vi.
- Giảm độ phức tạp vận hành của kiến trúc recommendation cũ.

### 3.1.2 Tối ưu hiệu năng với cache

Thay đổi chính:
- Hoàn thiện cache truy vấn trên Redis.
- Cải tiến phân trang và quản lý phiên truy vấn recommendation.
- Mở rộng theo dõi các chỉ số cache.

Tác động:
- Giảm độ trễ API recommendation.
- Giảm tải đọc lặp lại lên tầng dữ liệu.
- Tăng khả năng quan sát để tinh chỉnh hiệu năng thực tế.

### 3.1.3 Nâng cấp dữ liệu và luồng sự kiện

Thay đổi chính:
- Bổ sung nền tảng embedding profile theo hướng vector.
- Cải tiến xử lý sự kiện đồ thị và sự kiện embedding profile.
- Bổ sung công cụ warmup/backfill để rút ngắn thời gian chuẩn bị sau triển khai.

Tác động:
- Nâng chất lượng tìm profile tương đồng.
- Tăng độ ổn định dữ liệu recommendation sau nâng cấp.

## 3.2 Social Service

### 3.2.0 Điểm nhấn: chuyển dịch trung tâm logic

Thay đổi cốt lõi của Social là dịch chuyển vai trò:
- Trước đây: Social vừa xử lý nghiệp vụ social graph, vừa gánh một phần logic recommendation nội bộ.
- Hiện tại: Social tập trung nghiệp vụ quan hệ xã hội; phần quyết định recommendation được ủy quyền rõ cho Recommendation Service.

Ý nghĩa:
- Ranh giới trách nhiệm giữa service rõ ràng hơn.
- Giảm chồng chéo logic và giảm rủi ro sai lệch kết quả giữa các nơi tính toán.
- Dễ bảo trì và mở rộng hơn theo đúng năng lực lõi của từng service.

### 3.2.1 Đồng bộ với pipeline recommendation mới

Thay đổi chính:
- Điều chỉnh lớp client tích hợp recommendation.
- Cập nhật luồng query và tracking recommendation trong module friendship.
- Loại bỏ một số thành phần/kiểu dữ liệu cũ không còn dùng.
- Cập nhật repository để thống nhất contract liên service.

Tác động:
- Ranh giới social/recommendation rõ hơn.
- Giảm trùng lặp logic xếp hạng nội bộ.
- Tăng khả năng theo dõi hành vi tương tác recommendation (ví dụ dismiss).

### 3.2.2 Mở rộng đối soát chất lượng

Thay đổi chính:
- Tăng cường bộ test e2e/live theo hướng so sánh và báo cáo.
- Hoàn thiện kiểm tra chất lượng recommendation theo nhiều kịch bản.

Tác động:
- Dễ đánh giá tác động sau mỗi lần tinh chỉnh recommendation.
- Giảm rủi ro hồi quy chất lượng ở môi trường thực.

## 3.3 Chatbot Service

### 3.3.0 Giới thiệu chatbot

Chatbot là trợ lý AI nội bộ dạng popup trên màn hình chính, hỗ trợ người dùng tra cứu nhanh cách sử dụng các tính năng Sentimeta như bài viết, nhóm, tìm kiếm, chat, hồ sơ, quyền riêng tư và gợi ý bạn bè.

Trong đợt cập nhật này, chatbot được định vị rõ là lớp hỗ trợ trải nghiệm người dùng:
- Hướng dẫn và giải thích theo ngữ cảnh.
- Không thay thế các module nghiệp vụ chính.
- Tăng tính liên tục giữa các lần trò chuyện.

### 3.3.1 Nâng cấp năng lực xử lý ngữ cảnh

Thay đổi chính:
- Cải tiến lớp xử lý ngữ cảnh và tri thức nội bộ (RAG).
- Bổ sung cơ chế giới hạn phạm vi trả lời và tối ưu prompt.
- Chuẩn hóa bộ từ khóa và logic kiểm soát phạm vi câu hỏi.

Tác động:
- Trả lời sát ngữ cảnh hệ thống hơn.
- Giảm nguy cơ trả lời lệch chủ đề.

### 3.3.2 Bổ sung bộ nhớ và lịch sử hội thoại

Thay đổi chính:
- Giữ Redis cho short-term session memory (recent history/summary/intent/sources).
- Bổ sung PostgreSQL để lưu bền vững chat history.
- Thêm API xem/xóa lịch sử qua gateway với cursor pagination.

Tác động:
- Trải nghiệm hội thoại liền mạch hơn.
- Đảm bảo vẫn đọc lại lịch sử khi Redis TTL hết hạn.
- Tăng khả năng kiểm soát dữ liệu theo nhu cầu vận hành và quyền riêng tư.

## 4. Tác động liên service

1. Recommendation trở thành trung tâm quyết định logic gợi ý ở runtime.
2. Social tập trung social graph và tích hợp, không phân tán logic recommendation.
3. Chatbot tận dụng tri thức hệ thống tốt hơn để hỗ trợ user hiểu các tính năng social/recommendation.
4. Bộ tool demo hỗ trợ kiểm thử liên service sát kịch bản sử dụng thực tế.

## 5. Rủi ro và điểm cần theo dõi

1. Rủi ro lệch migration/schema của recommendation khi triển khai đa môi trường.
2. Rủi ro tăng dung lượng lưu trữ khi lưu chat history bền vững.
3. Rủi ro stale data nếu cấu hình TTL cache chưa phù hợp.
4. Rủi ro lệch contract giữa social và recommendation sau các đợt refactor tiếp theo.

## 6. Checklist nghiệm thu đề xuất

1. Recommendation:
- Kiểm tra truy vấn với user mới và user có dữ liệu đầy đủ.
- Kiểm tra cache hit/miss, TTL và phân trang.

2. Social:
- Kiểm tra đầy đủ luồng request, accept, decline, remove, block, unblock.
- Kiểm tra tracking và dismiss recommendation.

3. Chatbot:
- Kiểm tra hội thoại có giữ ngữ cảnh theo phiên.
- Kiểm tra lấy/xóa lịch sử hội thoại qua gateway.
- Kiểm tra cơ chế giới hạn phạm vi câu hỏi.

## 7. Kiến nghị triển khai

1. Duy trì live compare/report định kỳ sau mỗi lần cập nhật recommendation.
2. Thiết lập dashboard theo dõi cache, latency và tỷ lệ fallback.
3. Ban hành chính sách vòng đời dữ liệu chat history.
4. Chuẩn hóa checklist regression liên service trước khi release.

---

Ghi chú: thông tin kỹ thuật cấp commit và chi tiết nội bộ được lưu ở tài liệu tham chiếu riêng, không đưa vào nội dung trình bày chính.
