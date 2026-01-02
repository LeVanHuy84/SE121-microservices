import { EventTopic } from '../../social';

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
    isActive: boolean;
    createdAt: Date;
  };
  [UserEventType.UPDATED]: {
    userId: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    bio?: string;
    isActive?: boolean;
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
