import { MediaItemDTO } from './media.dto';

// post-event.dto.ts
export enum PostEventType {
  POST_CREATED = 'POST_CREATED',
  POST_UPDATED = 'POST_UPDATED',
  REMOVE_FEED = 'REMOVE_FEED',
}

export class PostCreatedEvent {
  type: PostEventType.POST_CREATED;
  payload: {
    postId: string;
    userId: string;
    groupId?: string;
    content?: string;
    mediaPreviews?: MediaItemDTO[];
    mediaRemaining?: number;
    createdAt: Date;
  };
}

export class PostUpdatedEvent {
  type: PostEventType.POST_UPDATED;
  payload: {
    postId: string;
    content: string;
  };
}

export class PostDeletedEvent {
  type: PostEventType.REMOVE_FEED;
  payload: {
    postId: string;
  };
}

export type PostEventMessage =
  | PostCreatedEvent
  | PostUpdatedEvent
  | PostDeletedEvent;
