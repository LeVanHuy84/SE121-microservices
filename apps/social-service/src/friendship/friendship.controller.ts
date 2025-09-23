/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Controller, Inject, UseInterceptors } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import { Transaction } from 'neo4j-driver';
import { firstValueFrom } from 'rxjs';
import { Neo4jTransactionInterceptor } from 'src/neo4j/neo4j-transaction.interceptor';
import { FriendshipService } from './friendship.service';

@Controller()
export class FriendshipController {
  constructor(
    private readonly friendshipService: FriendshipService,
    @Inject('USER_SERVICE') private readonly userRedisClient: ClientProxy,
  ) {}

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
  @MessagePattern({ cmd: 'accept_friend_request' })
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

  @MessagePattern({ cmd: 'remove_friend' })
  async removeFriend(
    @Payload()
    data: {
      userId: string;
      friendId: string;
    },
  ) {
    return this.friendshipService.removeFriend(data.userId, data.friendId);
  }

  @MessagePattern({ cmd: 'get_friends' })
  async getFriends(@Payload() data: { userId: string }) {
    const friendIds = await this.friendshipService.getFriends(data.userId);
    if (!friendIds.length) {
      return { friends: [] };
    }

    // gọi User Service để lấy profile
    const friends = await firstValueFrom(
      this.userRedisClient.send({ cmd: 'getUsersBatch' }, { ids: friendIds }),
    );

    const ordered = friendIds.map((id) => friends.find((f) => f.id === id));

    return { friends: ordered };
  }
  @MessagePattern({ cmd: 'recommend_friends' })
  async recommendFriends(@Payload() data: { userId: string }) {
    const recommendations = await this.friendshipService.recommendFriends(
      data.userId,
    );

    if (!recommendations.length) {
      return { recommendations: [] };
    }

    // gọi User Service để lấy profile
    const users = await firstValueFrom(
      this.userRedisClient.emit(
        { cmd: 'getUserBatch' },
        { ids: recommendations.map((r) => r.id) },
      ),
    );

    return recommendations.map((r) => ({
      ...users.find((u) => u.id === r.id),
      mutualFriends: r.mutualFriends,
    }));
  }

  // ---------- BLOCK ----------
  @UseInterceptors(Neo4jTransactionInterceptor)
  @MessagePattern({ cmd: 'block_user' })
  async blockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
      transaction: Transaction;
    },
  ) {
    return this.friendshipService.blockUser(
      data.userId,
      data.targetId,
      data.transaction,
    );
  }

  @MessagePattern({ cmd: 'unblock_user' })
  async unblockUser(
    @Payload()
    data: {
      userId: string;
      targetId: string;
    },
  ) {
    return this.friendshipService.unblockUser(data.userId, data.targetId);
  }
}
