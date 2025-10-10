import { MediaItemDTO } from '../common/media.dto';
import { EventTopic } from './event.enum';

export enum ShareEventType {
  CREATED = 'share.created',
  UPDATED = 'share.updated',
  REMOVED = 'share.removed',
}

export interface ShareEventPayloads {
  [ShareEventType.CREATED]: {
    userId: string;
    shareId: string;
    content: string;
    post: {
      postId: string;
      userId: string;
      groupId?: string;
      content?: string;
      mediaPreviews?: MediaItemDTO[];
      mediaRemaining?: number;
      createdAt: Date;
    };
    createdAt: Date;
  };
  [ShareEventType.UPDATED]: {
    shareId: string;
    content: string;
  };
  [ShareEventType.REMOVED]: {
    shareId: string;
  };
}

export type ShareEvent<K extends ShareEventType> = {
  topic: EventTopic.SHARE;
  type: K;
  payload: ShareEventPayloads[K];
};

export type ShareEventMessage =
  | ShareEvent<ShareEventType.CREATED>
  | ShareEvent<ShareEventType.UPDATED>
  | ShareEvent<ShareEventType.REMOVED>;

export type InferSharePayload<T extends ShareEventType> = ShareEventPayloads[T];
