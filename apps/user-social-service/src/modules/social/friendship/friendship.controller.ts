import { TcpMessagePattern } from "@repo/common";
import { Controller } from "@nestjs/common";
import { Payload } from "@nestjs/microservices";
import { CursorPaginationDTO } from "@repo/dtos";
import { FriendshipService } from "./friendship.service";

@Controller()
export class FriendshipController {
  constructor(private readonly friendshipService: FriendshipService) {}

  @TcpMessagePattern("get_relationship_status")
  getRelationshipStatus(@Payload() data: { userId: string; targetId: string }) {
    return this.friendshipService.getRelationshipStatus(
      data.userId,
      data.targetId,
    );
  }

  @TcpMessagePattern("send_friend_request")
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

  @TcpMessagePattern("cancel_friend_request")
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

  @TcpMessagePattern("accept_friend_request")
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

  @TcpMessagePattern("decline_friend_request")
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

  @TcpMessagePattern("remove_friend")
  async removeFriend(
    @Payload()
    data: {
      userId: string;
      friendId: string;
    },
  ) {
    return this.friendshipService.removeFriend(data.userId, data.friendId);
  }

  @TcpMessagePattern("get_friends_request")
  async getFriendsRequest(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getFriendRequests(data.userId, data.query);
  }

  @TcpMessagePattern("get_friends")
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

  @TcpMessagePattern("get_blocked_users")
  async getBlockedUsers(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getBlockedUsers(data.userId, data.query);
  }

  @TcpMessagePattern("suggest_friends")
  async recommendFriends(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.recommendFriends(data.userId, data.query);
  }

  @TcpMessagePattern("get_friend_recommendation_analytics")
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

  @TcpMessagePattern("get_global_friend_recommendation_analytics")
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

  @TcpMessagePattern("block_user")
  async blockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.blockUser(data.userId, data.targetId);
  }

  @TcpMessagePattern("dismiss_friend_recommendation")
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

  @TcpMessagePattern("unblock_user")
  async unblockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.unblockUser(data.userId, data.targetId);
  }

  @TcpMessagePattern({ cmd: "get_friend_ids" })
  async getFriendIds(@Payload() payload: { userId: string; limit: number }) {
    return this.friendshipService.getFriendIds(payload.userId, payload.limit);
  }
}
