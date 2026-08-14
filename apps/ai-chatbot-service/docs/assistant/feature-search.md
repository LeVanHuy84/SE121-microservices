---
id: feature-search
title: Tính năng tìm kiếm
type: help_doc
visibility: public
---

# Tính năng tìm kiếm

Search-service hỗ trợ tìm kiếm các thực thể như bài viết, nhóm và người dùng. Kết quả search thường dùng để lấy ứng viên ban đầu, sau đó gateway hydrate qua service nguồn để kiểm tra quyền và lấy dữ liệu đầy đủ trước khi gửi sang Assistant.

## Search không phải là nguồn dữ liệu cuối cùng

Search-service có thể trả về id, score, snippet hoặc dữ liệu tóm tắt. Tuy nhiên, dữ liệu này có thể chưa đủ để đưa vào prompt vì chưa chắc đã phản ánh quyền xem hiện tại của người dùng. Vì vậy, kết quả search nên được hydrate qua post-service, group-service hoặc user-service.

Assistant chỉ nên coi context là đáng tin nếu context đã được gateway gửi sau bước lọc quyền. Không được dựa vào kết quả search thô chưa hydrate để khẳng định nội dung riêng tư.

## Tìm bài viết

Khi người dùng tìm bài viết, gateway có thể gọi `search_posts` với query, limit, sortBy và order. Sau khi nhận `postIds`, gateway gọi post-service để lấy bài viết theo `currentUserId`. Những bài không trả về sau hydrate phải bị loại khỏi context.

Nếu không có kết quả, Assistant nên gợi ý dùng từ khóa cụ thể hơn, tên người đăng, tên nhóm, hoặc giảm bớt bộ lọc.

## Tìm nhóm

Khi người dùng tìm nhóm, gateway có thể gọi `search_groups`. Kết quả nên được hydrate qua group-service. Assistant có thể giới thiệu nhóm dựa trên tên, mô tả và metadata được phép hiển thị.

Nếu người dùng không thấy nhóm, hãy giải thích rằng nhóm có thể riêng tư, chưa được index hoặc từ khóa chưa khớp với tên/mô tả nhóm.

## Tìm người dùng

Khi người dùng tìm người dùng khác, gateway có thể gọi `search_users`, sau đó hydrate qua user-service. Assistant có thể dùng thông tin hồ sơ công khai hoặc được phép hiển thị như tên, bio, sở thích hoặc metadata khác nếu context có.

Không được tiết lộ email, số điện thoại, token, định danh nội bộ nhạy cảm hoặc dữ liệu riêng tư nếu context không có và chính sách không cho phép.

## Cách Assistant diễn giải kết quả search

Nếu context có nhiều kết quả, Assistant nên tóm tắt ngắn gọn theo từng loại: bài viết, nhóm, người dùng. Câu trả lời nên dùng từ "mình tìm thấy" hoặc "trong dữ liệu hiện có" để tránh khẳng định quá mức.

Nếu kết quả có score, Assistant có thể ưu tiên kết quả score cao hơn, nhưng không nên giải thích score như xác suất chính xác tuyệt đối. Score chỉ là tín hiệu xếp hạng tìm kiếm.

## Khi search không có kết quả

Nếu không có context phù hợp, Assistant nên nói rõ chưa tìm thấy kết quả phù hợp. Hãy gợi ý thay đổi từ khóa, kiểm tra chính tả, thử tìm theo thực thể khác hoặc mở màn hình liên quan để hệ thống có thêm context.
