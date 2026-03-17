import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import {
  FriendRecommendation,
  SocialGraphRepository,
} from './social-graph.repository';

@Injectable()
export class PostgresSocialGraphRepository implements SocialGraphRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FriendRequestEntity)
    private readonly friendRequestRepo: Repository<FriendRequestEntity>,
    @InjectRepository(FriendshipEntity)
    private readonly friendshipRepo: Repository<FriendshipEntity>,
    @InjectRepository(UserBlockEntity)
    private readonly userBlockRepo: Repository<UserBlockEntity>,
  ) {}

  async getRelationshipStatus(userId: string, targetId: string) {
    const [block, reverseBlock, friendship, outgoingRequest, incomingRequest] =
      await Promise.all([
        this.userBlockRepo.existsBy({ blockerId: userId, blockedId: targetId }),
        this.userBlockRepo.existsBy({ blockerId: targetId, blockedId: userId }),
        this.friendshipRepo.existsBy({ userId, friendId: targetId }),
        this.friendRequestRepo.existsBy({
          requesterId: userId,
          receiverId: targetId,
        }),
        this.friendRequestRepo.existsBy({
          requesterId: targetId,
          receiverId: userId,
        }),
      ]);

    if (block || reverseBlock) return { status: 'BLOCKED' as const };
    if (friendship) return { status: 'FRIEND' as const };
    if (outgoingRequest) return { status: 'REQUESTED_OUT' as const };
    if (incomingRequest) return { status: 'REQUESTED_IN' as const };
    return { status: 'NONE' as const };
  }

  async sendFriendRequest(userId: string, targetId: string) {
    await this.friendRequestRepo
      .createQueryBuilder()
      .insert()
      .into(FriendRequestEntity)
      .values({ requesterId: userId, receiverId: targetId })
      .orIgnore()
      .execute();
  }

  async cancelFriendRequest(userId: string, targetId: string) {
    await this.friendRequestRepo.delete({
      requesterId: userId,
      receiverId: targetId,
    });
  }

  async acceptFriendRequest(userId: string, requesterId: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(FriendRequestEntity, {
        requesterId,
        receiverId: userId,
      });

      await manager
        .createQueryBuilder()
        .insert()
        .into(FriendshipEntity)
        .values([
          { userId, friendId: requesterId, sentimentScore: 0 },
          { userId: requesterId, friendId: userId, sentimentScore: 0 },
        ])
        .orIgnore()
        .execute();
    });
  }

  async declineFriendRequest(userId: string, requesterId: string) {
    await this.friendRequestRepo.delete({
      requesterId,
      receiverId: userId,
    });
  }

  async removeFriend(userId: string, friendId: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(FriendshipEntity, [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ]);
    });
  }

  async blockUser(userId: string, targetId: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(FriendshipEntity, [
        { userId, friendId: targetId },
        { userId: targetId, friendId: userId },
      ]);

      await manager.delete(FriendRequestEntity, [
        { requesterId: userId, receiverId: targetId },
        { requesterId: targetId, receiverId: userId },
      ]);

      await manager
        .createQueryBuilder()
        .insert()
        .into(UserBlockEntity)
        .values({ blockerId: userId, blockedId: targetId })
        .orIgnore()
        .execute();
    });
  }

  async unblockUser(userId: string, targetId: string) {
    await this.userBlockRepo.delete({
      blockerId: userId,
      blockedId: targetId,
    });
  }

  async getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const rows = await this.friendshipRepo.find({
      where: {
        userId,
        ...(query.cursor ? { friendId: MoreThan(query.cursor) } : {}),
      },
      order: { friendId: 'ASC' },
      take: query.limit + 1,
      select: {
        friendId: true,
      },
    });

    return this.buildStringPage(
      rows.map((row) => row.friendId),
      query.limit,
    );
  }

  async getFriendRequests(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const rows = await this.friendRequestRepo.find({
      where: {
        receiverId: userId,
        ...(query.cursor ? { requesterId: MoreThan(query.cursor) } : {}),
      },
      order: { requesterId: 'ASC' },
      take: query.limit + 1,
      select: {
        requesterId: true,
      },
    });

    return this.buildStringPage(
      rows.map((row) => row.requesterId),
      query.limit,
    );
  }

  async recommendFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<FriendRecommendation>> {
    const cursorClause = query.cursor ? 'AND candidate_id > $2' : '';
    const limitParamIndex = query.cursor ? 3 : 2;
    const params = query.cursor
      ? [userId, query.cursor, query.limit + 1]
      : [userId, query.limit + 1];

    const rows = await this.dataSource.query(
      `
      WITH candidate_mutuals AS (
        SELECT
          f2.user_id AS candidate_id,
          COUNT(DISTINCT f1.friend_id)::int AS mutual_friends,
          ARRAY_AGG(DISTINCT f1.friend_id ORDER BY f1.friend_id) AS mutual_friend_ids
        FROM friendships f1
        INNER JOIN friendships f2
          ON f1.friend_id = f2.friend_id
        WHERE f1.user_id = $1
          AND f2.user_id <> $1
        GROUP BY f2.user_id
      )
      SELECT
        candidate_id AS id,
        mutual_friends AS "mutualFriends",
        mutual_friend_ids AS "mutualFriendIds"
      FROM candidate_mutuals cm
      WHERE NOT EXISTS (
          SELECT 1 FROM friendships direct_friend
          WHERE direct_friend.user_id = $1
            AND direct_friend.friend_id = cm.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests outgoing_req
          WHERE outgoing_req.requester_id = $1
            AND outgoing_req.receiver_id = cm.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests incoming_req
          WHERE incoming_req.requester_id = cm.candidate_id
            AND incoming_req.receiver_id = $1
      )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks block_out
          WHERE block_out.blocker_id = $1
            AND block_out.blocked_id = cm.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks block_in
          WHERE block_in.blocker_id = cm.candidate_id
            AND block_in.blocked_id = $1
      )
        ${cursorClause}
      ORDER BY "mutualFriends" DESC, id ASC
      LIMIT $${limitParamIndex}
      `,
      params,
    );

    const hasNextPage = rows.length > query.limit;
    const data = hasNextPage ? rows.slice(0, query.limit) : rows;

    return {
      data: data.map((row) => ({
        id: String(row.id),
        mutualFriends: Number(row.mutualFriends),
        mutualFriendIds: (row.mutualFriendIds ?? []).map((value: unknown) =>
          String(value),
        ),
      })),
      nextCursor: hasNextPage ? String(data[data.length - 1].id) : null,
      hasNextPage,
    };
  }

  async getFriendIds(userId: string, limit?: number): Promise<string[]> {
    const rows = await this.friendshipRepo.find({
      where: { userId },
      order: { since: 'DESC' },
      ...(typeof limit === 'number'
        ? { take: Math.max(0, Math.floor(limit)) }
        : {}),
      select: {
        friendId: true,
      },
    });

    return rows.map((row) => row.friendId);
  }

  async getBlockedUsers(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const rows = await this.userBlockRepo.find({
      where: {
        blockerId: userId,
        ...(query.cursor ? { blockedId: MoreThan(query.cursor) } : {}),
      },
      order: { blockedId: 'ASC' },
      take: query.limit + 1,
      select: {
        blockedId: true,
      },
    });

    return this.buildStringPage(
      rows.map((row) => row.blockedId),
      query.limit,
    );
  }

  private buildStringPage(
    ids: string[],
    limit: number,
  ): CursorPageResponse<string> {
    const hasNextPage = ids.length > limit;
    const data = hasNextPage ? ids.slice(0, limit) : ids;

    return {
      data,
      nextCursor: hasNextPage ? data[data.length - 1] : null,
      hasNextPage,
    };
  }
}
