import { Injectable } from '@nestjs/common';
import {
  AnalysisEventType,
  CreatedAnalysisEventPayload,
  EventDestination,
  EventTopic,
  MediaType,
  TargetType,
  UpdatedAnalysisEventPayload,
} from '@repo/dtos';
import { OutboxEvent } from 'src/entities/outbox.entity';

@Injectable()
export class OutboxService {
  async createAnalysisEvent(manager: any, targetType: TargetType, entity: any) {
    let imageUrls: string[] = [];

    switch (targetType) {
      case TargetType.POST:
        imageUrls = entity.media?.length
          ? entity.media
              .filter((item) => item.type === MediaType.IMAGE)
              .map((item) => item.url)
          : [];
        break;

      case TargetType.COMMENT:
        imageUrls =
          entity.media && entity.media.type === MediaType.IMAGE
            ? [entity.media.url]
            : [];
        break;

      default:
        return null;
    }

    const payload: CreatedAnalysisEventPayload = {
      userId: entity.userId,
      targetId: entity.id,
      targetType,
      content: entity.content,
      imageUrls,
    };

    const outbox = manager.create(OutboxEvent, {
      topic: EventTopic.ANALYSIS,
      destination: EventDestination.KAFKA,
      eventType: AnalysisEventType.CREATED,
      payload,
    });

    return await manager.save(outbox);
  }

  async updatedAnalysisEvent(
    manager: any,
    targetType: TargetType,
    targetId: string,
    newContent: string
  ) {
    const payload: UpdatedAnalysisEventPayload = {
      targetId,
      targetType,
      content: newContent,
    };

    const outbox = manager.create(OutboxEvent, {
      topic: EventTopic.ANALYSIS,
      destination: EventDestination.KAFKA,
      eventType: AnalysisEventType.UPDATED,
      payload,
    });

    return await manager.save(outbox);
  }
}
