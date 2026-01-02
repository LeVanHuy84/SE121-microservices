export const SETTING_LABELS: Record<string, string> = {
  requiredPostApproval: 'Duyệt bài trước khi đăng',
  maxMembers: 'Số thành viên tối đa',
  requireAdminApprovalToJoin: 'Yêu cầu admin duyệt khi tham gia',
  allowMemberInvite: 'Cho phép thành viên mời',
};

export const GROUP_FIELD_LABELS: Record<string, string> = {
  name: 'Tên nhóm',
  description: 'Mô tả',
  coverImage: 'Ảnh bìa',
  avatarUrl: 'Ảnh đại diện',
  privacy: 'Quyền riêng tư',
  rules: 'Nội quy',
};

export const formatValue = (v: any) => {
  if (typeof v === 'boolean') return v ? 'Bật' : 'Tắt';
  if (v === null || v === undefined) return '—';
  return v;
};
