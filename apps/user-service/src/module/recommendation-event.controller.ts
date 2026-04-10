import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  EventTopic,
  RecommendationProfileEventType,
} from '@repo/dtos';
import type { RecommendationProfileEventMessage } from '@repo/dtos';
import { UserService } from './user.service';

@Controller()
export class RecommendationEventController {
  private readonly logger = new Logger(RecommendationEventController.name);

  constructor(private readonly userService: UserService) {}

  @EventPattern(EventTopic.RECOMMENDATION_RESULT)
  async handleRecommendationProfileEvents(
    @Payload() message: RecommendationProfileEventMessage,
  ) {
    const { type, payload } = message;

    switch (type) {
      case RecommendationProfileEventType.EMBEDDING_COMPLETED:
        await this.userService.applyRecommendationProfileEmbedding(payload);
        break;
      case RecommendationProfileEventType.EMBEDDING_FAILED:
        this.logger.warn(
          `Recommendation embedding failed for userId=${payload.userId} requestId=${payload.requestId}: ${payload.error}`,
        );
        break;
      default:
        this.logger.warn(`Unknown recommendation result event type: ${type}`);
        break;
    }
  }
}
