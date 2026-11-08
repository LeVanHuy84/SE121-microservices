import { KafkaConsumerHelper, KafkaEventPattern } from "@repo/common";
import { Controller, Logger } from "@nestjs/common";
import { Ctx, KafkaContext, Payload } from "@nestjs/microservices";
import { UserService } from "./user.service";
import {
  EventTopic,
  PostEventType,
  RecommendationGraphEventType,
} from "@repo/dtos";
import type {
  PostEventMessage,
  RecommendationGraphEventMessage,
} from "@repo/dtos";

@Controller()
export class UserEventController {
  private readonly logger = new Logger(UserEventController.name);

  constructor(
    private readonly userService: UserService,
    private readonly consumerHelper: KafkaConsumerHelper,
  ) {}

  @KafkaEventPattern(EventTopic.POST)
  async handlePostEvent(
    @Payload() message: PostEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    // Do not count group posts for personal profile stats
    if ("groupId" in message.payload && message.payload.groupId) {
      return;
    }

    const topic = context?.getTopic?.() || EventTopic.POST;
    const partition = context?.getPartition?.() || 0;
    const raw = context?.getMessage?.();
    const eventId =
      raw?.key?.toString() ||
      `${topic}-${partition}-${raw?.offset ?? Date.now()}`;

    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        if (message.type === PostEventType.CREATED) {
          await this.userService.incrementPostCount(message.payload.userId);
          this.logger.log(
            `Incremented postCount for user ${message.payload.userId}`,
          );
        } else if (message.type === PostEventType.REMOVED) {
          if (message.payload.userId) {
            await this.userService.decrementPostCount(message.payload.userId);
            this.logger.log(
              `Decremented postCount for user ${message.payload.userId}`,
            );
          } else {
            this.logger.warn(
              `Received REMOVED event without userId for post ${message.payload.postId}`,
            );
          }
        }
      },
    });
  }

  @KafkaEventPattern(EventTopic.RECOMMENDATION_GRAPH)
  async handleGraphEvent(
    @Payload() message: RecommendationGraphEventMessage,
    @Ctx() context: KafkaContext,
  ) {
    const topic = context?.getTopic?.() || EventTopic.RECOMMENDATION_GRAPH;
    const partition = context?.getPartition?.() || 0;
    const raw = context?.getMessage?.();
    const eventId =
      raw?.key?.toString() ||
      `${topic}-${partition}-${raw?.offset ?? Date.now()}`;

    await this.consumerHelper.handleStateless({
      topic,
      eventId,
      message,
      context,
      handler: async () => {
        if (
          message.type === RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED
        ) {
          const { userId, targetUserId } = message.payload;
          await this.userService.incrementFriendCount([userId, targetUserId]);
          this.logger.log(
            `Incremented friendCount for users ${userId}, ${targetUserId}`,
          );
        } else if (
          message.type === RecommendationGraphEventType.FRIENDSHIP_REMOVED
        ) {
          const { userId, targetUserId } = message.payload;
          await this.userService.decrementFriendCount([userId, targetUserId]);
          this.logger.log(
            `Decremented friendCount for users ${userId}, ${targetUserId}`,
          );
        }
      },
    });
  }
}
