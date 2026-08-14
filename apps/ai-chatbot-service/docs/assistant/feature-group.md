---
id: feature-group
title: Tính năng nhóm
type: help_doc
visibility: public
---

# Tính năng nhóm

Nhóm là không gian để người dùng tham gia, đăng bài và tương tác theo một chủ đề chung. Group-service là nguồn dữ liệu chính cho thông tin nhóm, thành viên, quyền riêng tư và các thao tác liên quan đến nhóm.

## Loại thông tin nhóm

Thông tin nhóm thường gồm tên nhóm, mô tả, ảnh đại diện, quyền riêng tư, số thành viên, trạng thái tham gia của người dùng hiện tại và thời gian tạo. Assistant chỉ được dùng những trường có trong context đã được gateway hoặc group-service cung cấp.

Nếu context chỉ có tên nhóm và mô tả, Assistant có thể giải thích nhóm nói về gì. Nếu context không có danh sách thành viên, Assistant không được nói ai đang ở trong nhóm.

## Quyền riêng tư của nhóm

Nhóm có thể công khai, riêng tư hoặc có cơ chế duyệt thành viên tùy theo nghiệp vụ. Với nhóm riêng tư, người dùng có thể không thấy bài viết hoặc thông tin chi tiết nếu chưa phải thành viên. Assistant phải tôn trọng kết quả lọc quyền từ group-service.

Nếu người dùng hỏi vì sao không thấy nhóm hoặc bài trong nhóm, hãy nêu các nguyên nhân như nhóm riêng tư, chưa tham gia nhóm, request tham gia chưa được duyệt, nhóm đã bị xóa hoặc kết quả tìm kiếm chưa được index.

## Thao tác trong nhóm

Assistant có thể hướng dẫn cách tìm nhóm, tham gia nhóm, rời nhóm, đăng bài trong nhóm hoặc xem bài viết trong nhóm. Assistant không tự thực hiện thao tác tham gia, rời nhóm hoặc duyệt thành viên nếu không có API action riêng được gọi và trả kết quả.

Khi người dùng muốn tham gia nhóm, câu trả lời nên hướng dẫn mở trang nhóm và chọn hành động tham gia. Nếu nhóm cần duyệt, hãy giải thích rằng yêu cầu có thể cần admin nhóm chấp thuận.

## Gợi ý retrieval cho nhóm

Khi câu hỏi có từ khóa như nhóm, group, cộng đồng, tham gia nhóm, rời nhóm hoặc tìm nhóm, gateway có thể gọi `search_groups`. Sau đó gateway nên hydrate thông tin nhóm qua group-service để đảm bảo chỉ gửi dữ liệu người dùng có quyền xem.

Nếu group-service không trả về nhóm sau bước hydrate, Assistant không nên dùng kết quả search thô để trả lời về nhóm đó.

## Cách trả lời phù hợp

Nếu context có nhiều nhóm, hãy so sánh ngắn gọn theo tên, mô tả và metadata có sẵn. Nếu người dùng hỏi "nhóm nào phù hợp với tôi" nhưng không có hồ sơ hoặc sở thích trong context, hãy nói cần thêm thông tin về sở thích hoặc mục tiêu của người dùng.

Không được khẳng định mức độ hoạt động, số thành viên chính xác hoặc danh sách bài viết trong nhóm nếu context không chứa các dữ liệu đó.
