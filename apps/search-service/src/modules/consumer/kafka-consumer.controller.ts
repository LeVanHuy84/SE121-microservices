import { Controller, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import { EventTopic, PostEventType } from '@repo/dtos';
import type {
  GroupEventMessage,
  PostEventMessage,
  UserEventMessage,
} from '@repo/dtos';
import { KafkaConsumerHelper } from '@repo/common';
import { PostConsumerService } from './service/post-consumer.service';
import { GroupConsumerService } from './service/group-consumer.service';
import { UserConsumerService } from './service/user-consumer.service';

@Controller()
export class KafkaConsumerController {
  constructor(
    private readonly postConsumer: PostConsumerService,
    private readonly groupConsumer: GroupConsumerService,
    private readonly userConsumer: UserConsumerService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}
  private readonly logger = new Logger(KafkaConsumerController.name);

  // ----------------------------
  // POST TOPIC HANDLER
  // ----------------------------
  @EventPattern(EventTopic.POST)
  async handlePostEvents(
    @Payload() message: PostEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();
    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        const { type, payload } = message;

        switch (type) {
          case PostEventType.CREATED:
            this.logger.log(`Post created: ${payload.postId}`);
            await this.postConsumer.createPostIndex(payload);
            break;

          case PostEventType.UPDATED:
            this.logger.log(`Post updated: ${payload.postId}`);
            await this.postConsumer.updatePostIndex(payload);
            break;

          case PostEventType.REMOVED:
            this.logger.log(`Post removed: ${payload.postId}`);
            await this.postConsumer.removePostIndex(payload);
            break;

          default:
            this.logger.warn(`Unknown POST event type: ${type}`);
            break;
        }
      },
    });
  }

  @EventPattern(EventTopic.GROUP_CRUD)
  async handleGroupEvents(
    @Payload() message: GroupEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();
    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        const { type, payload } = message;

        switch (type) {
          case 'group.created':
            this.logger.log(`Group created: ${payload.groupId}`);
            await this.groupConsumer.createGroupIndex(payload);
            break;
          case 'group.updated':
            this.logger.log(`Group updated: ${payload.groupId}`);
            await this.groupConsumer.updateGroupIndex(payload);
            break;
          case 'group.removed':
            this.logger.log(`Group removed: ${payload.groupId}`);
            await this.groupConsumer.removeGroupIndex(payload);
            break;
          default:
            this.logger.warn(`Unknown GROUP event type: ${type}`);
            break;
        }
      },
    });
  }

  @EventPattern(EventTopic.USER)
  async handleUserEvents(
    @Payload() message: UserEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context.getTopic();
    const partition = context.getPartition();
    const raw = context.getMessage();
    const eventId =
      raw.key?.toString() || `${topic}-${partition}-${raw.offset}`;

    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        const { type, payload } = message;

        switch (type) {
          case 'user.created':
            this.logger.log(`User created: ${payload.userId}`);
            await this.userConsumer.createUserIndex(payload);
            break;
          case 'user.updated':
            this.logger.log(`User updated: ${payload.userId}`);
            await this.userConsumer.updateUserIndex(payload);
            break;
          case 'user.removed':
            this.logger.log(`User removed: ${payload.userId}`);
            await this.userConsumer.removeUserIndex(payload);
            break;
          default:
            this.logger.warn(`Unknown USER event type: ${type}`);
            break;
        }
      },
    });
  }
}
