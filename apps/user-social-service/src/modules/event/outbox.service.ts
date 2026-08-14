import { Inject, Injectable } from "@nestjs/common";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import { outboxEvents } from "src/drizzle/schema/schema";
import type { DrizzleDB } from "src/drizzle/types/drizzle";
import {
  ActivityType,
  EventDestination,
  EventTopic,
  RecommendationGraphDismissedPayload,
  RecommendationGraphEventPayload,
  RecommendationGraphEventType,
  RecommendationProfileEmbeddingRequestedPayload,
  RecommendationProfileEventType,
  UserActivityLogPayload,
} from "@repo/dtos";

@Injectable()
export class OutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  createOutboxEvent(
    destination: EventDestination,
    topic: string,
    eventType: string,
    payload: Record<string, any>,
  ) {
    return this.db
      .insert(outboxEvents)
      .values({
        destination,
        topic,
        eventType,
        payload,
      })
      .returning();
  }

  createOutboxEventWithTransaction(
    tx: any,
    destination: EventDestination,
    topic: string,
    eventType: string,
    payload: Record<string, any>,
  ) {
    return tx
      .insert(outboxEvents)
      .values({
        destination,
        topic,
        eventType,
        payload,
      })
      .returning();
  }

  // ==========================================
  // USER SERVICE OUTBOX HELPERS
  // ==========================================
  createUserOutboxEvent(
    tx: any,
    eventType: string,
    payload: Record<string, any>,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.USER,
      eventType,
      payload,
    );
  }

  createLoggingOutboxEvent(
    tx: any,
    eventType: string,
    payload: Record<string, any>,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.LOGGING,
      eventType,
      payload,
    );
  }

  createRecommendationProfileEmbeddingRequestedEvent(
    tx: any,
    payload: RecommendationProfileEmbeddingRequestedPayload,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.RECOMMENDATION_PROFILE,
      RecommendationProfileEventType.EMBEDDING_REQUESTED,
      payload,
    );
  }

  // ==========================================
  // SOCIAL SERVICE OUTBOX HELPERS
  // ==========================================
  createRecommendationGraphEvent(
    tx: any,
    eventType: Exclude<
      RecommendationGraphEventType,
      RecommendationGraphEventType.RECOMMENDATION_DISMISSED
    >,
    payload: RecommendationGraphEventPayload,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.RECOMMENDATION_GRAPH,
      eventType,
      payload,
    );
  }

  createRecommendationGraphDismissedEvent(
    tx: any,
    payload: RecommendationGraphDismissedPayload,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.RECOMMENDATION_GRAPH,
      RecommendationGraphEventType.RECOMMENDATION_DISMISSED,
      payload,
    );
  }

  createUserActivityEvent(
    tx: any,
    activityType: ActivityType,
    payload: UserActivityLogPayload,
  ) {
    return this.createOutboxEventWithTransaction(
      tx,
      EventDestination.KAFKA,
      EventTopic.USER_ACTIVITY_LOG,
      activityType,
      payload,
    );
  }
}
