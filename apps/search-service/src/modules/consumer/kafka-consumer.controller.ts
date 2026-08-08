import { Controller, Logger } from '@nestjs/common';
import {
  EventPattern,
  Payload,
  Ctx,
  KafkaContext,
} from '@nestjs/microservices';
import {
  EventTopic,
  PostEventType,
  TargetType,
  GroupEventType,
  UserEventType,
} from '@repo/dtos';
import type {
  GroupEventMessage,
  PostEventMessage,
  UserEventMessage,
  AnalysisResultEvent,
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
      handler: () => {
        const { type, payload } = message;

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
            this.logger.warn(`Unknown POST event type: ${String(type)}`);
            break;
        }
        return Promise.resolve();
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
      handler: () => {
        const { type, payload } = message;

        switch (type) {
          case GroupEventType.CREATED:
            this.logger.log(`Group created: ${payload.groupId}`);
            this.groupConsumer.createGroupIndex(payload);
            break;
          case GroupEventType.UPDATED:
            this.logger.log(`Group updated: ${payload.groupId}`);
            this.groupConsumer.updateGroupIndex(payload);
            break;
          case GroupEventType.REMOVED:
            this.logger.log(`Group removed: ${payload.groupId}`);
            this.groupConsumer.removeGroupIndex(payload);
            break;
          default:
            this.logger.warn(`Unknown GROUP event type: ${String(type)}`);
            break;
        }
        return Promise.resolve();
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
      handler: () => {
        const { type, payload } = message;

        switch (type) {
          case UserEventType.CREATED:
            this.logger.log(`User created: ${payload.userId}`);
            this.userConsumer.createUserIndex(payload);
            break;
          case UserEventType.UPDATED:
            this.logger.log(`User updated: ${payload.userId}`);
            this.userConsumer.updateUserIndex(payload);
            break;
          case UserEventType.REMOVED:
            this.logger.log(`User removed: ${payload.userId}`);
            this.userConsumer.removeUserIndex(payload);
            break;
          default:
            this.logger.warn(`Unknown USER event type: ${String(type)}`);
            break;
        }
        return Promise.resolve();
      },
    });
  }

  @EventPattern(EventTopic.EMOTION_RESULT)
  async handleEmotionResultEvents(
    @Payload() message: AnalysisResultEvent,
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
      handler: () => {
        const { payload } = message;

        if (payload.targetType === TargetType.POST) {
          this.logger.log(
            `Handling emotion result for post: ${payload.targetId}`,
          );
          this.postConsumer.handleEmotionResult(payload);
        }
        return Promise.resolve();
      },
    });
  }
}
