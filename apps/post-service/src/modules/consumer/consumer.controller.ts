import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import {
  AnalysisResultEvent,
  EventTopic,
  ModerationRejectedEvent,
} from '@repo/dtos';
import { ConsumerService } from './consumer.service';

@Controller('ingestion')
export class ConsumerController {
  private readonly logger = new Logger(ConsumerController.name);

  constructor(private readonly consumerService: ConsumerService) {}

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(EventTopic.EMOTION_RESULT)
  async handleAnalysisEvents(@Payload() message: AnalysisResultEvent) {
    const { type, payload } = message;

    try {
      await this.consumerService.handleEmotionResult(payload);
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.targetId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }

  @EventPattern(EventTopic.MODERATION_REJECTED)
  async handleModerationRejected(@Payload() message: ModerationRejectedEvent) {
    const { type, payload } = message;

    try {
      await this.consumerService.handleModerationRejected(payload);
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.targetId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
