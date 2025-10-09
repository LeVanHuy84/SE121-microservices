import { MediaItemDTO } from './media.dto';

// post-event.dto.ts
export enum ShareEventType {
  SHARED_POST = 'SHARED_POST',
  UPDATE_SHARE = 'UPDATE_SHARE',
  REMOVE_SHARE = 'REMOVE_SHARE',
}

export class SharedPostEvent {
  type: ShareEventType.SHARED_POST;
  payload: {
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
}

export class ShareUpdatedEvent {
  type: ShareEventType.UPDATE_SHARE;
  payload: {
    shareId: string;
    content: string;
  };
}

export class ShareDeletedEvent {
  type: ShareEventType.REMOVE_SHARE;
  payload: {
    shareId: string;
  };
}

export type ShareEventMessage =
  | SharedPostEvent
  | ShareUpdatedEvent
  | ShareDeletedEvent;
