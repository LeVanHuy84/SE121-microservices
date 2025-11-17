export enum PostGroupEventType {
  // CREATED = 'post.created',
  POST_PENDING = 'post_pending',
  POST_APPROVED = 'post_approved',
  POST_REJECTED = 'post_rejected',
}

export interface PostGroupEventPayload {
  postId: string;
  groupId: string;
  userId: string;
  content: string;
  actorId?: string;
}

export interface PostGroupEvent {
  type: PostGroupEventType;
  payload: PostGroupEventPayload;
}
