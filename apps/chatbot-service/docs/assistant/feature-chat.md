---
id: feature-chat
title: Tính năng chat
type: help_doc
visibility: public
---

# Tính năng chat

Tính năng chat cho phép người dùng nhắn tin trực tiếp hoặc trò chuyện trong nhóm. Chat service quản lý conversation, participants, message, lastMessage, trạng thái đã đọc và các sự kiện realtime liên quan đến cuộc trò chuyện.

## Conversation trực tiếp

Một cuộc trò chuyện trực tiếp giữa hai người dùng nên được định danh bằng khóa ổn định dựa trên hai participant. Mục tiêu là tránh tạo nhiều conversation 1-1 trùng nhau cho cùng một cặp người dùng. Khi người dùng mở chat với một người khác, hệ thống nên tìm conversation có sẵn trước, nếu chưa có thì tạo mới.

Khi triển khai AI Assistant như một bot chung cho mọi người dùng, nên dùng một bot user hệ thống duy nhất nhưng tạo conversation 1-1 riêng giữa từng user và bot. Không nên tạo một group chat có tất cả người dùng và bot vì sẽ làm lộ lịch sử, context và câu hỏi riêng của từng người dùng.

## Conversation nhóm

Conversation nhóm có nhiều participants. Assistant chỉ nên tham gia group chat nếu nghiệp vụ cho phép rõ ràng và mọi thành viên hiểu rằng bot có thể đọc context trong cuộc trò chuyện đó. Với MVP, nên ưu tiên bot 1-1 để đơn giản hóa quyền riêng tư và tránh nhầm lẫn.

Nếu sau này bot được thêm vào nhóm, hệ thống cần kiểm soát quyền đọc message, quyền trả lời, phạm vi context gửi sang Assistant và cơ chế tắt bot trong từng nhóm.

## Luồng gửi tin nhắn cho bot

Khi người dùng gửi tin nhắn cho bot, chat-service nên lưu message của người dùng trước. Sau đó hệ thống có thể gọi assistant endpoint trực tiếp hoặc tạo job bất đồng bộ để sinh câu trả lời. Khi LLM trả lời, bot reply được lưu như một message bình thường với `senderId` là bot user.

Cần có guard để bot không tự kích hoạt vòng lặp trả lời chính nó. Nếu message mới có sender là bot user, consumer hoặc handler không nên gọi Assistant tiếp.

## Realtime và trạng thái đã đọc

Sau khi message được lưu, gateway hoặc chat-service phát sự kiện realtime đến các client đang tham gia conversation. Client có thể cập nhật lastMessage, unread count và trạng thái đã đọc. Nếu người dùng báo chat không realtime, hãy hướng dẫn kiểm tra mạng, đăng nhập lại, mở lại conversation hoặc reload app.

Assistant không nên khẳng định trạng thái realtime cụ thể nếu context không có thông tin từ chat-service.

## Dữ liệu được phép dùng trong câu trả lời

Assistant chỉ được tóm tắt nội dung cuộc trò chuyện nếu backend đã gửi message context hợp lệ. Không được suy đoán nội dung tin nhắn cũ chỉ dựa vào conversationId. Không được tiết lộ tin nhắn của cuộc trò chuyện khác.

Nếu context chỉ có thông tin tính năng, Assistant có thể giải thích cách chat hoạt động, nhưng không được nói rằng một tin nhắn cụ thể đã được gửi, đã đọc hoặc đã xóa nếu context không chứa dữ liệu đó.

## Gợi ý trả lời cho người dùng

Nếu người dùng hỏi "làm sao chat với bot", hãy hướng dẫn mở cuộc trò chuyện với Assistant và gửi câu hỏi như chat bình thường.

Nếu người dùng hỏi "bot có thấy tin nhắn của tôi không", hãy giải thích rằng bot chỉ xử lý nội dung được hệ thống gửi vào context để trả lời, và việc gửi context phải tuân theo xác thực, phân quyền và chính sách riêng tư.
