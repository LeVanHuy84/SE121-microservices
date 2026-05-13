---
id: faq
title: Câu hỏi thường gặp
type: help_doc
visibility: public
---

# Câu hỏi thường gặp

Tài liệu này giúp Assistant trả lời các câu hỏi phổ biến của người dùng về Sentimeta. Nếu câu hỏi có liên quan đến dữ liệu cụ thể, Assistant phải ưu tiên context runtime đã được backend cung cấp.

## Vì sao không tìm thấy bài viết?

Người dùng có thể không tìm thấy bài viết vì từ khóa quá chung, bộ lọc không phù hợp, bài viết chưa được search-service index, bài viết đã bị xóa, hoặc người dùng hiện tại không có quyền xem. Một số bài viết có thể thuộc nhóm riêng tư, chỉ hiển thị với thành viên nhóm hoặc chỉ hiển thị với phạm vi người xem nhất định.

Khi trả lời, hãy gợi ý người dùng thử từ khóa cụ thể hơn, kiểm tra chính tả, kiểm tra bộ lọc, tìm theo tên người đăng hoặc tên nhóm nếu có. Không được khẳng định bài viết tồn tại nếu context không chứa bài viết đó.

## Vì sao không thấy gợi ý bạn bè?

Gợi ý bạn bè có thể trống khi hồ sơ người dùng chưa đủ thông tin, hệ thống chưa có ứng viên phù hợp, dữ liệu graph chưa được cập nhật, hoặc các ứng viên đã bị lọc vì đã là bạn bè, đã gửi lời mời, đã bị chặn, đã bị bỏ qua hoặc không đủ điểm phù hợp.

Nếu người dùng hỏi cách cải thiện gợi ý, hãy gợi ý cập nhật hồ sơ, thêm sở thích, tham gia nhóm liên quan, tương tác tự nhiên với nội dung phù hợp và kiểm tra lại sau khi hệ thống precompute chạy.

## Vì sao chat không cập nhật thời gian thực?

Chat có thể không cập nhật ngay vì kết nối mạng không ổn định, websocket bị ngắt, phiên đăng nhập hết hạn, client chưa join đúng conversation, hoặc service realtime đang gặp lỗi tạm thời. Hãy gợi ý người dùng mở lại cuộc trò chuyện, kiểm tra mạng, đăng nhập lại hoặc tải lại ứng dụng.

Nếu context có thông tin lỗi cụ thể, hãy dùng lỗi đó để trả lời. Nếu không có, chỉ nên hướng dẫn kiểm tra cơ bản, không khẳng định nguyên nhân hạ tầng.

## Vì sao Assistant trả lời chưa đủ dữ liệu?

Khi Assistant nói chưa đủ dữ liệu, điều đó thường có nghĩa backend chưa gửi context phù hợp hoặc dữ liệu đã bị lọc theo quyền riêng tư. Assistant không được tự điền phần thiếu bằng suy đoán. Người dùng có thể thử hỏi cụ thể hơn, cung cấp thêm từ khóa hoặc mở đúng màn hình liên quan để frontend/gateway gửi thêm context.

## Assistant có thể làm gì?

Assistant có thể giải thích tính năng, hướng dẫn thao tác, tóm tắt context được gửi vào, diễn giải nguồn gợi ý, giúp người dùng hiểu vì sao không thấy kết quả và gợi ý bước tiếp theo. Assistant cũng có thể trả lời câu hỏi về cách dùng bài viết, nhóm, tìm kiếm, chat và gợi ý bạn bè dựa trên docs RAG.

Assistant không tự thay đổi dữ liệu, không tự gửi lời mời kết bạn, không tự xóa bài, không tự tham gia nhóm và không tự truy cập dữ liệu riêng tư. Các hành động này cần API nghiệp vụ riêng có xác thực.

## Khi nào nên hỏi lại người dùng?

Nếu câu hỏi quá mơ hồ như "tìm giúp mình cái đó" hoặc "sao không thấy", Assistant nên hỏi lại một câu ngắn để lấy thêm thông tin, ví dụ: "Bạn muốn tìm bài viết, nhóm hay người dùng?" hoặc "Bạn nhớ từ khóa, tên người đăng hoặc tên nhóm không?".

Nếu context đã đủ để trả lời, không cần hỏi lại. Hãy trả lời trực tiếp và nêu nguồn hoặc phạm vi dữ liệu nếu cần.
