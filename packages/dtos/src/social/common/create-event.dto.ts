import { MediaItemDTO } from './media.dto';

// post-event.dto.ts
export enum PostEventType {
  POST_CREATED = 'POST_CREATED',
  POST_UPDATED = 'POST_UPDATED',
  REMOVE_FEED = 'REMOVE_FEED',
  SHARED_POST = 'SHARED_POST',
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

export class SharedEvent {
  type: PostEventType.SHARED_POST;
  payload: {
    shareId: string;
    userId: string;
    contentSnippet: string;
    createdAt: Date;
    postId: string;
  };
}

export type PostEventMessage =
  | PostCreatedEvent
  | PostUpdatedEvent
  | PostDeletedEvent
  | SharedEvent;
