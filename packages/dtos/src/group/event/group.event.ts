import { EventTopic } from '../../social';
import { GroupPrivacy } from '../enums';

export enum GroupEventType {
  CREATED = 'group.created',
  UPDATED = 'group.updated',
  REMOVED = 'group.removed',
}

export interface GroupEventPayloads {
  [GroupEventType.CREATED]: {
    groupId: string;
    name: string;
    description?: string;
    avatarUrl?: string;
    privacy: GroupPrivacy;
    members: number;
    createdAt: Date;
  };
  [GroupEventType.UPDATED]: {
    groupId: string;
    name?: string;
    description?: string;
    avatarUrl?: string;
    privacy?: GroupPrivacy;
    members?: number;
  };
  [GroupEventType.REMOVED]: {
    groupId: string;
  };
}

export type GroupEvent<K extends GroupEventType> = {
  topic: EventTopic.GROUP_CRUD;
  type: K;
  payload: GroupEventPayloads[K];
};

export type GroupEventMessage =
  | GroupEvent<GroupEventType.CREATED>
  | GroupEvent<GroupEventType.UPDATED>
  | GroupEvent<GroupEventType.REMOVED>;

export type InferGroupPayload<T extends GroupEventType> = GroupEventPayloads[T];
