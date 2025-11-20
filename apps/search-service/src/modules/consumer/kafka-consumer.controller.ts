import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EventTopic, PostEventType } from '@repo/dtos';
import type { GroupEventMessage, PostEventMessage } from '@repo/dtos';
import { PostConsumerService } from './service/post-consumer.service';
import { GroupConsumerService } from './service/group-consumer.service';

@Controller()
export class KafkaConsumerController {
  constructor(
    private readonly postConsumer: PostConsumerService,
    private readonly consumerService: GroupConsumerService,
  ) {}
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
          this.postConsumer.createPostIndex(payload);
          break;

        case PostEventType.UPDATED:
          this.logger.log(`Post updated: ${payload.postId}`);
          this.postConsumer.updatePostIndex(payload);
          break;

        case PostEventType.REMOVED:
          this.logger.log(`Post removed: ${payload.postId}`);
          this.postConsumer.removePostIndex(payload);
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

  @EventPattern(EventTopic.GROUP_CRUD)
  async handleGroupEvents(@Payload() message: GroupEventMessage) {
    const { type, payload } = message;
    try {
      switch (type) {
        case 'group.created':
          this.logger.log(`Group created: ${payload.groupId}`);
          this.consumerService.createGroupIndex(payload);
          break;
        case 'group.updated':
          this.logger.log(`Group updated: ${payload.groupId}`);
          this.consumerService.updateGroupIndex(payload);
          break;
        case 'group.removed':
          this.logger.log(`Group removed: ${payload.groupId}`);
          this.consumerService.removeGroupIndex(payload);
          break;
        default:
          this.logger.warn(`Unknown GROUP event type: ${type}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Failed to process GROUP event ${type} for ${payload.groupId}: ${error.message}`,
        error.stack,
      );
      throw error; // để Kafka retry lại
    }
  }
}
