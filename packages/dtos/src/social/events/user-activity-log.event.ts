import { ActivityType } from '../../log';

export class UserActivityLogPayload {
  actorId: string;
  activityType: ActivityType;
  targetId: string;
  targetOwnerId?: string;
  contentPreview?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export class UserActivityLogEvent {
  type: string;
  payload: UserActivityLogPayload;
}
