import { Controller, UseInterceptors } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CursorPaginationDTO } from '@repo/dtos';
import { Transaction } from 'neo4j-driver';
import { Neo4jTransactionInterceptor } from 'src/neo4j/neo4j-transaction.interceptor';
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
  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('send_friend_request')
  async sendFriendRequest(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.sendFriendRequest(
      data.transaction,
      data.userId,
      data.targetId,
    );
  }
  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('cancel_friend_request')
  async cancelFriendRequest(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.cancelFriendRequest(
      data.transaction,
      data.userId,
      data.targetId,
    );
  }

  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('accept_friend_request')
  async acceptFriendRequest(
    @Payload()
    data: {
      userId: string;
      requesterId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.acceptFriendRequest(
      data.transaction,
      data.userId,
      data.requesterId,
    );
  }

  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('decline_friend_request')
  async declineFriendRequest(
    @Payload()
    data: {
      userId: string;
      requesterId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.declineFriendRequest(
      data.transaction,
      data.userId,
      data.requesterId,
    );
  }

  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('remove_friend')
  async removeFriend(
    @Payload()
    data: {
      userId: string;
      friendId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.removeFriend(
      data.transaction,
      data.userId,
      data.friendId,
    );
  }

  @MessagePattern('get_friends_request')
  async getFriendsRequest(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getFriendRequests(data.userId, data.query);
  }

  @MessagePattern('get_friends')
  async getFriends(
    @Payload() data: { userId: string; query: CursorPaginationDTO },
  ) {
    return this.friendshipService.getFriends(data.userId, data.query);
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

  // ---------- BLOCK ----------
  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern('block_user')
  async blockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.blockUser(
      data.transaction,
      data.userId,
      data.targetId,
    );
  }

  @MessagePattern('unblock_user')
  @UseInterceptors(Neo4jTransactionInterceptor)
  async unblockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.unblockUser(
      data.transaction,
      data.userId,
      data.targetId,
    );
  }

  @MessagePattern({ cmd: 'get_friend_ids' })
  async getFriendIds(@Payload() payload: { userId: string; limit: number }) {
    return this.friendshipService.getFriendIds(payload.userId, payload.limit);
  }
}
