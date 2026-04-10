import { EventTopic } from './event.enum';

export enum RecommendationProfileEventType {
  EMBEDDING_REQUESTED = 'recommendation.profile.embedding.requested',
  EMBEDDING_COMPLETED = 'recommendation.profile.embedding.completed',
  EMBEDDING_FAILED = 'recommendation.profile.embedding.failed',
}

export interface RecommendationProfileEmbeddingRequestedPayload {
  userId: string;
  semanticProfileText: string | null;
  requestId: string;
  triggeredBy: 'user.created' | 'user.updated';
  schemaVersion: 1;
  requestedAt: string;
}

export interface RecommendationProfileEmbeddingCompletedPayload {
  userId: string;
  semanticProfileText: string | null;
  requestId: string;
  schemaVersion: 1;
  modelName: string;
  embedding: number[];
  dimensions: number;
  generatedAt: string;
}

export interface RecommendationProfileEmbeddingFailedPayload {
  userId: string;
  semanticProfileText: string | null;
  requestId: string;
  schemaVersion: 1;
  modelName: string;
  error: string;
  failedAt: string;
}

export type RecommendationProfileEmbeddingRequestedEvent = {
  topic: EventTopic.RECOMMENDATION_PROFILE;
  type: RecommendationProfileEventType.EMBEDDING_REQUESTED;
  payload: RecommendationProfileEmbeddingRequestedPayload;
};

export type RecommendationProfileEmbeddingCompletedEvent = {
  topic: EventTopic.RECOMMENDATION_RESULT;
  type: RecommendationProfileEventType.EMBEDDING_COMPLETED;
  payload: RecommendationProfileEmbeddingCompletedPayload;
};

export type RecommendationProfileEmbeddingFailedEvent = {
  topic: EventTopic.RECOMMENDATION_RESULT;
  type: RecommendationProfileEventType.EMBEDDING_FAILED;
  payload: RecommendationProfileEmbeddingFailedPayload;
};

export type RecommendationProfileEventMessage =
  | RecommendationProfileEmbeddingRequestedEvent
  | RecommendationProfileEmbeddingCompletedEvent
  | RecommendationProfileEmbeddingFailedEvent;
