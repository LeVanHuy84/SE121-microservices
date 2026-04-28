import { Injectable } from '@nestjs/common';
import {
  EventDestination,
  EventTopic,
  RecommendationGraphDismissedPayload,
  RecommendationGraphEventPayload,
  RecommendationGraphEventType,
} from '@repo/dtos';
import { EntityManager } from 'typeorm';
import { OutboxEventEntity } from 'src/postgres/entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  createRecommendationGraphEvent(
    manager: EntityManager,
    eventType: Exclude<
      RecommendationGraphEventType,
      RecommendationGraphEventType.RECOMMENDATION_DISMISSED
    >,
    payload: RecommendationGraphEventPayload,
  ) {
    return this.createOutboxEvent(
      manager,
      EventDestination.KAFKA,
      EventTopic.RECOMMENDATION_GRAPH,
      eventType,
      payload,
    );
  }

  createRecommendationGraphDismissedEvent(
    manager: EntityManager,
    payload: RecommendationGraphDismissedPayload,
  ) {
    return this.createOutboxEvent(
      manager,
      EventDestination.KAFKA,
      EventTopic.RECOMMENDATION_GRAPH,
      RecommendationGraphEventType.RECOMMENDATION_DISMISSED,
      payload,
    );
  }

  private createOutboxEvent(
    manager: EntityManager,
    destination: EventDestination,
    topic: string,
    eventType: string,
    payload: object,
  ) {
    const outboxEvent = manager.create(OutboxEventEntity, {
      destination,
      topic,
      eventType,
      payload,
    });

    return manager.save(outboxEvent);
  }
}
