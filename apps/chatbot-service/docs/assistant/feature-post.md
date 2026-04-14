---
id: feature-post
title: Tính năng bài viết
type: help_doc
visibility: public
---

# Tính năng bài viết

Bài viết là nội dung do người dùng tạo trong hệ thống. Một bài viết có thể gồm nội dung văn bản, media, người đăng, thời gian tạo, nhóm liên quan, quyền hiển thị, số lượt tương tác và trạng thái xử lý phụ thuộc vào service nguồn.

## Vai trò của post-service

Post-service là nguồn dữ liệu chính cho bài viết. Khi Assistant cần trả lời về một bài viết cụ thể, dữ liệu bài viết phải được hydrate từ post-service hoặc service nguồn tương ứng. Search-service có thể trả về danh sách id hoặc kết quả tìm kiếm sơ bộ, nhưng dữ liệu đưa vào prompt cần được lọc quyền qua service nguồn trước.

Gateway nên gửi `currentUserId` khi hydrate bài viết để post-service kiểm tra người dùng hiện tại có quyền xem hay không. Nếu post-service không trả bài viết, Assistant phải xem như không có dữ liệu hợp lệ.

## Quyền riêng tư của bài viết

Bài viết có thể bị ẩn khỏi người dùng vì nhiều lý do: thuộc nhóm riêng tư, người dùng không phải thành viên nhóm, phạm vi hiển thị bị giới hạn, bài viết đã bị xóa, người đăng đã chặn người dùng, hoặc chính sách moderation không cho hiển thị.

Assistant không được nói rằng bài viết tồn tại nếu context không có bài viết đó. Nếu người dùng hỏi "vì sao không thấy bài viết", hãy nêu các nguyên nhân có thể và gợi ý kiểm tra quyền xem, từ khóa tìm kiếm hoặc nhóm liên quan.

## Tóm tắt và giải thích bài viết

Nếu context chứa nội dung bài viết, Assistant có thể tóm tắt, giải thích ý chính hoặc giúp người dùng hiểu nội dung đó. Câu trả lời nên nói rõ phạm vi dựa trên bài viết được cung cấp trong context.

Nếu context chỉ có id bài viết nhưng không có content, Assistant không nên tóm tắt. Hãy nói rằng chưa có nội dung bài viết trong context để tóm tắt.

## Bài viết trong nhóm

Nếu bài viết thuộc nhóm, context có thể chứa `groupId`, tên nhóm hoặc metadata liên quan. Assistant có thể nói bài viết nằm trong nhóm nào nếu dữ liệu đó có trong context. Không được suy đoán tên nhóm hoặc quyền nhóm nếu context không có.

Nếu người dùng không thấy bài viết trong nhóm, nguyên nhân thường gặp là chưa tham gia nhóm, nhóm riêng tư, bài viết bị xóa, bài viết chưa index vào search hoặc bộ lọc tìm kiếm không phù hợp.

## Hành động với bài viết

Assistant có thể hướng dẫn cách tạo bài viết, tìm bài viết, chỉnh sửa nội dung, xóa bài hoặc tương tác với bài viết nếu ứng dụng hỗ trợ. Tuy nhiên Assistant không tự thực thi các hành động này. Việc tạo, sửa, xóa, like, comment hoặc share phải đi qua API nghiệp vụ có xác thực và phân quyền.

Khi người dùng yêu cầu "xóa bài này", Assistant nên hướng dẫn hoặc đề xuất chuyển sang endpoint/action phù hợp nếu frontend hỗ trợ. Không được trả lời rằng đã xóa thành công nếu chatbot-service không thực sự gọi API xóa bài và nhận kết quả thành công.

## Gợi ý retrieval cho bài viết

Khi câu hỏi có từ khóa như bài viết, post, nội dung, người đăng, caption, tìm bài, không thấy bài hoặc bài trong nhóm, gateway có thể gọi `search_posts`. Sau khi có `postIds`, gateway nên gọi `get_posts_batch(currentUserId, postIds)` để hydrate và lọc quyền. Chỉ các bài viết còn lại sau bước hydrate mới được gửi vào context của Assistant.
