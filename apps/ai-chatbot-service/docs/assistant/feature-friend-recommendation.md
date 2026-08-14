---
id: feature-friend-recommendation
title: Tính năng gợi ý bạn bè
type: help_doc
visibility: public
---

# Tính năng gợi ý bạn bè

Gợi ý bạn bè giúp người dùng tìm các hồ sơ có khả năng phù hợp để kết nối. Recommendation-service chịu trách nhiệm tính toán, precompute và trả kết quả gợi ý. Social-service hoặc gateway có thể gọi recommendation-service để lấy danh sách ứng viên, sau đó hydrate thông tin người dùng qua user-service trước khi hiển thị hoặc gửi vào context của Assistant.

## Nguồn tín hiệu gợi ý

Tín hiệu gợi ý có thể đến từ graph quan hệ bạn bè, bạn chung, tương tác, nhóm chung, hồ sơ cá nhân, sở thích, học vấn, công việc, vị trí hoặc embedding hồ sơ nếu hệ thống đã triển khai. Không phải lúc nào mọi tín hiệu cũng có sẵn. Assistant chỉ nên nhắc đến các tín hiệu này ở mức giải thích chung nếu context không có dữ liệu cụ thể.

Nếu context chứa lý do gợi ý như cùng nhóm, sở thích giống nhau hoặc có bạn chung, Assistant có thể diễn giải lý do đó cho người dùng. Nếu context không có lý do, không được tự nói rằng hai người có bạn chung hoặc sở thích giống nhau.

## Bộ lọc ứng viên

Ứng viên gợi ý có thể bị loại nếu đã là bạn bè, đã gửi lời mời kết bạn, đã nhận lời mời kết bạn, đã bị chặn, đã bị bỏ qua, là chính người dùng hiện tại, hoặc không thỏa điều kiện quyền riêng tư. Recommendation-service hoặc social-service nên xử lý các filter này trước khi kết quả được gửi đến frontend hoặc Assistant.

Nếu người dùng hỏi vì sao không thấy một người cụ thể trong gợi ý, Assistant nên trả lời rằng có thể người đó không nằm trong tập ứng viên hiện tại, đã bị lọc bởi trạng thái quan hệ hoặc chưa đủ tín hiệu phù hợp. Không được khẳng định nguyên nhân cụ thể nếu context không có.

## Precompute và cập nhật kết quả

Gợi ý bạn bè có thể được precompute để trả nhanh hơn. Khi hồ sơ, quan hệ bạn bè hoặc graph sự kiện thay đổi, hệ thống cần cập nhật trạng thái và tính lại kết quả theo lịch hoặc theo event. Vì vậy kết quả gợi ý có thể chưa thay đổi ngay lập tức sau khi người dùng cập nhật hồ sơ hoặc vừa kết bạn với ai đó.

Nếu người dùng vừa sửa hồ sơ nhưng chưa thấy gợi ý mới, hãy giải thích rằng hệ thống có thể cần thêm thời gian để cập nhật chỉ mục hoặc chạy precompute.

## Cách Assistant trả lời về gợi ý

Nếu context có danh sách người dùng được gợi ý, Assistant có thể tóm tắt vài người nổi bật và lý do nếu context có lý do. Nếu chỉ có tên và bio, Assistant chỉ nên mô tả dựa trên tên/bio đó. Không nên đánh giá con người theo cách nhạy cảm hoặc suy đoán đặc điểm cá nhân không có trong context.

Nếu người dùng hỏi "nên kết bạn với ai", Assistant nên dùng ngôn ngữ gợi ý nhẹ như "bạn có thể cân nhắc" thay vì khẳng định chắc chắn. Nếu context không đủ, hãy hỏi thêm sở thích hoặc mục tiêu kết nối của người dùng.

## Gọi service liên quan

Khi câu hỏi có intent gợi ý bạn bè, gateway hoặc social-service có thể gọi recommendation-service qua endpoint hoặc message pattern tương ứng để lấy kết quả. Sau đó userIds cần được hydrate qua user-service để lọc dữ liệu hồ sơ được phép hiển thị.

Chỉ context đã hydrate và lọc quyền mới được gửi sang chatbot-service. Assistant không tự gọi recommendation-service trực tiếp trong MVP nếu kiến trúc hiện tại đặt orchestration ở gateway.

## Quyền riêng tư

Assistant không được giải thích các tín hiệu nhạy cảm nếu context không có hoặc chính sách không cho phép. Ví dụ, không được nói "người này hay xem bài của bạn" hoặc "người này ở gần bạn" nếu dữ liệu đó không được gửi rõ ràng trong context.

Nếu người dùng yêu cầu xem danh sách người đã bỏ qua, người đã chặn hoặc lý do bị loại chi tiết, Assistant nên trả lời theo chính sách quyền riêng tư và chỉ dùng dữ liệu được backend cung cấp.
