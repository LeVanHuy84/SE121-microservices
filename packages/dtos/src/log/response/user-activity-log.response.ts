import { ActivityType } from '../enums';

export class UserActivityLogResponseDTO {
  id: string;
  actorId: string;
  activityType: ActivityType;
  targetId: string;
  contentPreview?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}
