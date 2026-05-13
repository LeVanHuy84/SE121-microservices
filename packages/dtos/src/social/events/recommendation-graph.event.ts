export enum RecommendationGraphEventType {
  FRIEND_REQUEST_SENT = 'recommendation.graph.friend-request-sent',
  FRIEND_REQUEST_CANCELED = 'recommendation.graph.friend-request-canceled',
  FRIEND_REQUEST_ACCEPTED = 'recommendation.graph.friend-request-accepted',
  FRIEND_REQUEST_DECLINED = 'recommendation.graph.friend-request-declined',
  FRIENDSHIP_REMOVED = 'recommendation.graph.friendship-removed',
  USER_BLOCKED = 'recommendation.graph.user-blocked',
  USER_UNBLOCKED = 'recommendation.graph.user-unblocked',
  RECOMMENDATION_DISMISSED = 'recommendation.graph.recommendation-dismissed',
}

export interface RecommendationGraphEventPayload {
  userId: string;
  targetUserId: string;
  schemaVersion: number;
  occurredAt: string;
  source: 'social-service';
}

export interface RecommendationGraphDismissedPayload
  extends RecommendationGraphEventPayload {
  expiresAt: string;
}

export type RecommendationGraphEventMessage =
  | {
      type:
        | RecommendationGraphEventType.FRIEND_REQUEST_SENT
        | RecommendationGraphEventType.FRIEND_REQUEST_CANCELED
        | RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED
        | RecommendationGraphEventType.FRIEND_REQUEST_DECLINED
        | RecommendationGraphEventType.FRIENDSHIP_REMOVED
        | RecommendationGraphEventType.USER_BLOCKED
        | RecommendationGraphEventType.USER_UNBLOCKED;
      payload: RecommendationGraphEventPayload;
    }
  | {
      type: RecommendationGraphEventType.RECOMMENDATION_DISMISSED;
      payload: RecommendationGraphDismissedPayload;
    };
