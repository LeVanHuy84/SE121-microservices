import { Controller, Logger } from '@nestjs/common';
import { KafkaConsumerService } from './kafka-consumer.service';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EventTopic, PostEventType } from '@repo/dtos';
import type { PostEventMessage } from '@repo/dtos';

@Controller()
export class KafkaConsumerController {
  constructor(private readonly consumerService: KafkaConsumerService) {}
  private readonly logger = new Logger(KafkaConsumerController.name);

  // ----------------------------
  // 🧩 POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(EventTopic.POST)
  async handlePostEvents(@Payload() message: PostEventMessage) {
    const { type, payload } = message;

    try {
      switch (type) {
        case PostEventType.CREATED:
          this.logger.log(`Post created: ${payload.postId}`);
          this.consumerService.createPostIndex(payload);
          break;

        case PostEventType.UPDATED:
          this.logger.log(`Post updated: ${payload.postId}`);
          this.consumerService.updatePostIndex(payload);
          break;

        case PostEventType.REMOVED:
          this.logger.log(`Post removed: ${payload.postId}`);
          this.consumerService.removePostIndex(payload);
          break;

        default:
          this.logger.warn(`Unknown POST event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process POST event ${type} for ${payload.postId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
