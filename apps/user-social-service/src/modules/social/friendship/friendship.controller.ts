import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO } from '@repo/dtos';
import { FriendshipService } from './friendship.service';

@Controller()
export class FriendshipController {
  constructor(private readonly friendshipService: FriendshipService) {}

  @MessagePattern('get_relationship_status')
  getRelationshipStatus(@Payload() data: { userId: string; targetId: string }) {
    return this.friendshipService.getRelationshipStatus(
      data.userId,
      data.targetId,
    );
  }

  @MessagePattern('send_friend_request')
  async sendFriendRequest(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      recommendationId?: string;
      recommendationRequestId?: string;
    },
  ) {
    return this.friendshipService.sendFriendRequest(
      data.userId,
      data.targetId,
      {
        recommendationId: data.recommendationId,
        recommendationRequestId: data.recommendationRequestId,
      },
    );
  }

  @MessagePattern('cancel_friend_request')
  async cancelFriendRequest(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.cancelFriendRequest(
      data.userId,
      data.targetId,
    );
  }

  @MessagePattern('accept_friend_request')
  async acceptFriendRequest(
    @Payload()
    data: {
      userId: string;
      requesterId: string;
    },
  ) {
    return this.friendshipService.acceptFriendRequest(
      data.userId,
      data.requesterId,
    );
  }

  @MessagePattern('decline_friend_request')
  async declineFriendRequest(
    @Payload()
    data: {
      userId: string;
      requesterId: string;
    },
  ) {
    return this.friendshipService.declineFriendRequest(
      data.userId,
      data.requesterId,
    );
  }

  @MessagePattern('remove_friend')
  async removeFriend(
    @Payload()
    data: {
      userId: string;
      friendId: string;
    },
  ) {
    return this.friendshipService.removeFriend(data.userId, data.friendId);
  }

  @MessagePattern('get_friends_request')
  async getFriendsRequest(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getFriendRequests(data.userId, data.query);
  }

  @MessagePattern('get_friends')
  async getFriends(
    @Payload()
    data: {
      requesterId: string;
      targetId: string;
      query: CursorPaginationDTO;
    },
  ) {
    return this.friendshipService.getFriends(
      data.requesterId,
      data.targetId,
      data.query,
    );
  }

  @MessagePattern('get_blocked_users')
  async getBlockedUsers(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getBlockedUsers(data.userId, data.query);
  }

  @MessagePattern('suggest_friends')
  async recommendFriends(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.recommendFriends(data.userId, data.query);
  }

  @MessagePattern('get_friend_recommendation_analytics')
  async getFriendRecommendationAnalytics(
    @Payload()
    data: {
      userId: string;
      days?: number;
    },
  ) {
    return this.friendshipService.getFriendRecommendationAnalytics(
      data.userId,
      data.days,
    );
  }

  @MessagePattern('get_global_friend_recommendation_analytics')
  async getGlobalFriendRecommendationAnalytics(
    @Payload()
    data: {
      days?: number;
    },
  ) {
    return this.friendshipService.getGlobalFriendRecommendationAnalytics(
      data.days,
    );
  }

  @MessagePattern('block_user')
  async blockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.blockUser(data.userId, data.targetId);
  }

  @MessagePattern('dismiss_friend_recommendation')
  async dismissFriendRecommendation(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      recommendationId?: string;
      recommendationRequestId?: string;
    },
  ) {
    return this.friendshipService.dismissFriendRecommendation(
      data.userId,
      data.targetId,
      {
        recommendationId: data.recommendationId,
        recommendationRequestId: data.recommendationRequestId,
      },
    );
  }

  @MessagePattern('unblock_user')
  async unblockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.unblockUser(data.userId, data.targetId);
  }

  @MessagePattern({ cmd: 'get_friend_ids' })
  async getFriendIds(@Payload() payload: { userId: string; limit: number }) {
    return this.friendshipService.getFriendIds(payload.userId, payload.limit);
  }
}
