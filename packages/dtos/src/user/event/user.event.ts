import { EventTopic } from '../../social';
import { PrivacyLevel, MessagePrivacy, UserPrivacySettings } from '../enums';

export enum UserEventType {
  CREATED = 'user.created',
  UPDATED = 'user.updated',
  REMOVED = 'user.removed',
}

export interface UserEventPayloads {
  [UserEventType.CREATED]: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    avatarUrl?: string;
    bio?: string;
    location?: string;
    jobTitle?: string;
    company?: string;
    school?: string;
    interests?: string[];
    isActive: boolean;
    createdAt: Date;
    privacySettings?: UserPrivacySettings;
  };
  [UserEventType.UPDATED]: {
    userId: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    bio?: string;
    location?: string;
    jobTitle?: string;
    company?: string;
    school?: string;
    interests?: string[];
    isActive?: boolean;
    privacySettings?: UserPrivacySettings;
  };
  [UserEventType.REMOVED]: {
    userId: string;
  };
}

export type UserEvent<K extends UserEventType> = {
  topic: EventTopic.USER;
  type: K;
  payload: UserEventPayloads[K];
};

export type UserEventMessage =
  | UserEvent<UserEventType.CREATED>
  | UserEvent<UserEventType.UPDATED>
  | UserEvent<UserEventType.REMOVED>;

export type InferUserPayload<T extends UserEventType> = UserEventPayloads[T];
