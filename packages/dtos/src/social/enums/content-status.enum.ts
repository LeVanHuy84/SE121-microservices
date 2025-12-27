// Enum hỗ trợ filter trạng thái nội dung
export enum ContentStatus {
  ACTIVE = 'ACTIVE', // hiển thị bình thường
  //   HIDDEN = 'HIDDEN',        // admin ẩn
  //   DELETED = 'DELETED',      // xóa vĩnh viễn (nếu có)
  //   PENDING = 'PENDING',      // chờ duyệt
  VIOLATED = 'VIOLATED', // vi phạm
}
