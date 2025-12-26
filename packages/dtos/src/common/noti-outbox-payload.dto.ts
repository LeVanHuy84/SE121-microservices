import { NotiTargetType } from '../notification';

export class NotiOutboxPayload {
  requestId?: string;
  receivers: string[];
  targetType: NotiTargetType;
  targetId: string; // để điều hướng
  actorName?: string;
  actorAvatar?: string; // hiển thị thông tin user hoặc group
  content: string;
}
