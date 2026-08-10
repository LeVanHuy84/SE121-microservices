import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { UserService } from './user.service';
import {
  EventTopic,
  PostEventType,
  RecommendationGraphEventType,
} from '@repo/dtos';
import type {
  PostEventMessage,
  RecommendationGraphEventMessage,
} from '@repo/dtos';

@Controller()
export class UserEventController {
  private readonly logger = new Logger(UserEventController.name);

  constructor(private readonly userService: UserService) {}

  @EventPattern(EventTopic.POST)
  async handlePostEvent(@Payload() message: PostEventMessage) {
    // Do not count group posts for personal profile stats
    if ('groupId' in message.payload && message.payload.groupId) {
      return;
    }

    try {
      if (message.type === PostEventType.CREATED) {
        await this.userService.incrementPostCount(message.payload.userId);
        this.logger.log(`Incremented postCount for user ${message.payload.userId}`);
      } else if (message.type === PostEventType.REMOVED) {
        // userId is now required in DTO
        if (message.payload.userId) {
          await this.userService.decrementPostCount(message.payload.userId);
          this.logger.log(`Decremented postCount for user ${message.payload.userId}`);
        } else {
          this.logger.warn(`Received REMOVED event without userId for post ${message.payload.postId}`);
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
