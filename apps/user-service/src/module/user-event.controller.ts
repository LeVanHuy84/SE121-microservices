import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import {
  EventTopic,
  PostEventMessage,
  PostEventType,
  RecommendationGraphEventMessage,
  RecommendationGraphEventType,
} from '@repo/dtos';

@Controller()
export class UserEventController {
  private readonly logger = new Logger(UserEventController.name);

  constructor(private readonly userService: UserService) {}

  @EventPattern(EventTopic.POST)
  async handlePostEvent(@Payload() message: PostEventMessage) {
    const { type, payload } = message;

    // Do not count group posts for personal profile stats
    if ('groupId' in payload && payload.groupId) {
      return;
    }

    try {
      if (type === PostEventType.CREATED) {
        await this.userService.incrementPostCount(payload.userId);
        this.logger.log(`Incremented postCount for user ${payload.userId}`);
      } else if (type === PostEventType.REMOVED) {
        // userId is now required in DTO
        if (payload.userId) {
          await this.userService.decrementPostCount(payload.userId);
          this.logger.log(`Decremented postCount for user ${payload.userId}`);
        } else {
          this.logger.warn(`Received REMOVED event without userId for post ${payload.postId}`);
        }
      }
    } catch (error) {
      this.logger.error(`Error handling POST event: ${error.message}`, error.stack);
    }
  }

  @EventPattern(EventTopic.RECOMMENDATION_GRAPH)
  async handleGraphEvent(@Payload() message: RecommendationGraphEventMessage) {
    try {
      if (message.type === RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED) {
        const { userId, targetUserId } = message.payload;
        await this.userService.incrementFriendCount([userId, targetUserId]);
        this.logger.log(`Incremented friendCount for users ${userId}, ${targetUserId}`);
      } else if (message.type === RecommendationGraphEventType.FRIENDSHIP_REMOVED) {
        const { userId, targetUserId } = message.payload;
        await this.userService.decrementFriendCount([userId, targetUserId]);
        this.logger.log(`Decremented friendCount for users ${userId}, ${targetUserId}`);
      }
    } catch (error) {
      this.logger.error(`Error handling RECOMMENDATION_GRAPH event: ${error.message}`, error.stack);
    }
  }
}
