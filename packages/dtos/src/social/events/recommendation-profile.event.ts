import { EventTopic } from './event.enum';

export enum RecommendationProfileEventType {
  EMBEDDING_REQUESTED = 'recommendation.profile.embedding.requested',
}

export interface RecommendationProfileEmbeddingRequestedPayload {
  userId: string;
  semanticProfileText: string | null;
  requestId: string;
  triggeredBy: 'user.created' | 'user.updated' | 'user.removed';
  schemaVersion: 1;
  requestedAt: string;
}

export type RecommendationProfileEmbeddingRequestedEvent = {
  topic: EventTopic.RECOMMENDATION_PROFILE;
  type: RecommendationProfileEventType.EMBEDDING_REQUESTED;
  payload: RecommendationProfileEmbeddingRequestedPayload;
};

export type RecommendationProfileEventMessage =
  RecommendationProfileEmbeddingRequestedEvent;
