export type RetrievalTarget = 'post' | 'group' | 'user';

export const POST_RETRIEVAL_KEYWORDS = [
  'post',
  'bai viet',
  'bai dang',
  'dang bai',
  'dang status',
  'status',
  'bai',
  'noi dung',
  'content',
  'caption',
  'bang tin',
  'feed',
  'newfeed',
  'news feed',
  'viet bai',
  'chia se bai viet',
] as const;

export const GROUP_RETRIEVAL_KEYWORDS = [
  'group',
  'nhom',
  'cong dong',
  'cau lac bo',
  'clb',
  'tham gia nhom',
  'nhom cong khai',
  'nhom kin',
] as const;

export const USER_RETRIEVAL_KEYWORDS = [
  'user',
  'tai khoan',
  'tai khoan nguoi dung',
  'trang ca nhan',
  'nguoi',
  'nguoi dung',
  'ban be',
  'ket ban',
  'goi y',
  'goi y ket ban',
  'de xuat ban be',
  'tim ban',
  'ket noi',
  'ho so',
  'profile',
  'friend',
  'recommend',
  'recommendation',
  'suggestion',
] as const;

export const DEFAULT_RETRIEVAL_TARGETS: RetrievalTarget[] = ['post', 'group'];
