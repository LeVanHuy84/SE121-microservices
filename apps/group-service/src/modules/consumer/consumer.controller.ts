import { Controller, Logger } from '@nestjs/common';
import { ConsumerService } from './consumer.service';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EventTopic, PostGroupEventType } from '@repo/dtos';
import type { PostGroupEvent } from '@repo/dtos';

@Controller()
export class ConsumerController {
  constructor(private readonly consumerService: ConsumerService) {}
  private readonly logger = new Logger(ConsumerController.name);

  @EventPattern(EventTopic.GROUP)
  async handlePostEvents(@Payload() message: PostGroupEvent) {
    const { type, payload } = message;

    try {
      switch (type) {
        // case PostGroupEventType.CREATED:
        //   this.logger.log(`Post created: ${payload.postId}`);
        //   await this.consumerService.handleCreated(payload);
        //   break;

        case PostGroupEventType.POST_PENDING:
          this.logger.log(`Post pending: ${payload.postId}`);
          await this.consumerService.handlePending(payload);
          break;

        case PostGroupEventType.POST_APPROVED:
          this.logger.log(`Post updated: ${payload.postId}`);
          await this.consumerService.handleApproved(payload);
          break;

        case PostGroupEventType.POST_REJECTED:
          this.logger.log(`Post removed: ${payload.postId}`);
          await this.consumerService.handleRejected(payload);
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
