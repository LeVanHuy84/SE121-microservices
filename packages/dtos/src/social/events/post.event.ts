import { MediaItemDTO } from '../../common';
import { Audience } from '../enums';
import { EventTopic } from './event.enum';

export enum PostEventType {
  CREATED = 'post.created',
  UPDATED = 'post.updated',
  REMOVED = 'post.removed',
}

export interface PostEventPayloads {
  [PostEventType.CREATED]: {
    postId: string;
    userId: string;
    groupId?: string;
    audience: Audience;
    content?: string;
    mediaPreviews?: MediaItemDTO[];
    mediaRemaining?: number;
    createdAt: Date;
  };
  [PostEventType.UPDATED]: {
    postId: string;
    content: string;
  };
  [PostEventType.REMOVED]: {
    postId: string;
  };
}

export type PostEvent<K extends PostEventType> = {
  topic: EventTopic.POST;
  type: K;
  payload: PostEventPayloads[K];
};

export type PostEventMessage =
  | PostEvent<PostEventType.CREATED>
  | PostEvent<PostEventType.UPDATED>
  | PostEvent<PostEventType.REMOVED>;

export type InferPostPayload<T extends PostEventType> = PostEventPayloads[T];
