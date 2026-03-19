import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CursorPaginationDTO, CursorPageResponse } from '@repo/dtos';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { FriendRecommendationEventEntity } from 'src/postgres/entities/friend-recommendation-event.entity';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { FriendRecommendationDismissalEntity } from 'src/postgres/entities/friend-recommendation-dismissal.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import {
  AcceptedFriendRequestAttribution,
  FriendRecommendationAnalyticsSource,
  FriendRecommendationAttribution,
  FriendRecommendationEvent,
  FriendRecommendation,
  SocialGraphRepository,
} from './social-graph.repository';

@Injectable()
export class PostgresSocialGraphRepository implements SocialGraphRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FriendRecommendationEventEntity)
    private readonly recommendationEventRepo: Repository<FriendRecommendationEventEntity>,
    @InjectRepository(FriendRequestEntity)
    private readonly friendRequestRepo: Repository<FriendRequestEntity>,
    @InjectRepository(FriendshipEntity)
    private readonly friendshipRepo: Repository<FriendshipEntity>,
    @InjectRepository(UserBlockEntity)
    private readonly userBlockRepo: Repository<UserBlockEntity>,
    @InjectRepository(FriendRecommendationDismissalEntity)
    private readonly recommendationDismissalRepo: Repository<FriendRecommendationDismissalEntity>,
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

  async sendFriendRequest(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ) {
    await this.friendRequestRepo
      .createQueryBuilder()
      .insert()
      .into(FriendRequestEntity)
      .values({
        requesterId: userId,
        receiverId: targetId,
        recommendationId: attribution?.recommendationId ?? null,
        recommendationRequestId: attribution?.recommendationRequestId ?? null,
      })
      .orIgnore()
      .execute();
  }

  async cancelFriendRequest(userId: string, targetId: string) {
    await this.friendRequestRepo.delete({
      requesterId: userId,
      receiverId: targetId,
    });
  }

  async acceptFriendRequest(
    userId: string,
    requesterId: string,
  ): Promise<AcceptedFriendRequestAttribution | null> {
    return this.dataSource.transaction(async (manager) => {
      const pendingRequest = await manager.findOne(FriendRequestEntity, {
        where: {
          requesterId,
          receiverId: userId,
        },
      });

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

      return pendingRequest
        ? {
            recommendationId: pendingRequest.recommendationId ?? null,
            recommendationRequestId:
              pendingRequest.recommendationRequestId ?? null,
          }
        : null;
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

  async dismissFriendRecommendation(
    userId: string,
    candidateId: string,
    expiresAt: Date,
  ) {
    await this.recommendationDismissalRepo.upsert(
      {
        userId,
        candidateId,
        expiresAt,
      },
      ['userId', 'candidateId'],
    );
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
        AND NOT EXISTS (
          SELECT 1 FROM friend_recommendation_dismissals dismissal
          WHERE dismissal.user_id = $1
            AND dismissal.candidate_id = cm.candidate_id
            AND dismissal.expires_at > NOW()
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

  async summarizeCandidates(
    userId: string,
    candidateIds: string[],
  ): Promise<FriendRecommendation[]> {
    const dedupedCandidateIds = [...new Set(candidateIds.filter(Boolean))];
    if (dedupedCandidateIds.length === 0) {
      return [];
    }

    const rows = await this.dataSource.query(
      `
      WITH requested_candidates AS (
        SELECT UNNEST($2::varchar[]) AS candidate_id
      )
      SELECT
        rc.candidate_id AS id,
        COUNT(DISTINCT candidate_friend.friend_id)::int AS "mutualFriends",
        COALESCE(
          ARRAY_AGG(DISTINCT candidate_friend.friend_id ORDER BY candidate_friend.friend_id)
            FILTER (WHERE candidate_friend.friend_id IS NOT NULL),
          '{}'
        ) AS "mutualFriendIds"
      FROM requested_candidates rc
      LEFT JOIN friendships viewer_friend
        ON viewer_friend.user_id = $1
      LEFT JOIN friendships candidate_friend
        ON candidate_friend.user_id = rc.candidate_id
       AND candidate_friend.friend_id = viewer_friend.friend_id
      WHERE NOT EXISTS (
          SELECT 1 FROM friendships direct_friend
          WHERE direct_friend.user_id = $1
            AND direct_friend.friend_id = rc.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests outgoing_req
          WHERE outgoing_req.requester_id = $1
            AND outgoing_req.receiver_id = rc.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM friend_requests incoming_req
          WHERE incoming_req.requester_id = rc.candidate_id
            AND incoming_req.receiver_id = $1
      )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks block_out
          WHERE block_out.blocker_id = $1
            AND block_out.blocked_id = rc.candidate_id
      )
        AND NOT EXISTS (
          SELECT 1 FROM user_blocks block_in
          WHERE block_in.blocker_id = rc.candidate_id
            AND block_in.blocked_id = $1
      )
        AND NOT EXISTS (
          SELECT 1 FROM friend_recommendation_dismissals dismissal
          WHERE dismissal.user_id = $1
            AND dismissal.candidate_id = rc.candidate_id
            AND dismissal.expires_at > NOW()
      )
      GROUP BY rc.candidate_id
      ORDER BY rc.candidate_id ASC
      `,
      [userId, dedupedCandidateIds],
    );

    return rows.map((row) => ({
      id: String(row.id),
      mutualFriends: Number(row.mutualFriends),
      mutualFriendIds: (row.mutualFriendIds ?? []).map((value: unknown) =>
        String(value),
      ),
    }));
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

  async recordRecommendationEvents(events: FriendRecommendationEvent[]) {
    if (events.length === 0) {
      return;
    }

    const insertValues = events.map((event) => ({
        userId: event.userId,
        candidateId: event.candidateId,
        eventType: event.eventType,
        recommendationId: event.recommendationId ?? null,
        recommendationRequestId: event.recommendationRequestId ?? null,
        metadata:
          (event.metadata ?? null) as FriendRecommendationEventEntity['metadata'],
      }));

    await this.recommendationEventRepo.insert(
      insertValues as Parameters<typeof this.recommendationEventRepo.insert>[0],
    );
  }

  async getFriendRecommendationAnalytics(userId: string, since: Date) {
    const totalRows = await this.dataSource.query(
      `
      SELECT
        event_type AS "eventType",
        COUNT(*)::int AS count
      FROM friend_recommendation_events
      WHERE user_id = $1
        AND created_at >= $2
      GROUP BY event_type
      `,
      [userId, since],
    );

    const sourceRows = await this.dataSource.query(
      `
      WITH served AS (
        SELECT
          recommendation_id,
          COALESCE((metadata->>'mutualFriends')::int, 0) AS mutual_friends,
          COALESCE((metadata->>'commonGroups')::int, 0) AS common_groups
        FROM friend_recommendation_events
        WHERE user_id = $1
          AND event_type = 'served'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      dismissed AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE user_id = $1
          AND event_type = 'dismissed'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      request_sent AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE user_id = $1
          AND event_type = 'request_sent'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      accepted AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE user_id = $1
          AND event_type = 'accepted'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      served_with_source AS (
        SELECT
          recommendation_id,
          CASE
            WHEN mutual_friends > 0 AND common_groups > 0 THEN 'mixed'
            WHEN mutual_friends > 0 THEN 'mutual_only'
            WHEN common_groups > 0 THEN 'group_only'
            ELSE 'fallback'
          END AS source
        FROM served
      )
      SELECT
        source,
        COUNT(*)::int AS served,
        COUNT(dismissed.recommendation_id)::int AS dismissed,
        COUNT(request_sent.recommendation_id)::int AS "requestSent",
        COUNT(accepted.recommendation_id)::int AS accepted
      FROM served_with_source served
      LEFT JOIN dismissed
        ON dismissed.recommendation_id = served.recommendation_id
      LEFT JOIN request_sent
        ON request_sent.recommendation_id = served.recommendation_id
      LEFT JOIN accepted
        ON accepted.recommendation_id = served.recommendation_id
      GROUP BY source
      ORDER BY source ASC
      `,
      [userId, since],
    );

    const totals = {
      served: 0,
      dismissed: 0,
      requestSent: 0,
      accepted: 0,
    };

    for (const row of totalRows) {
      switch (String(row.eventType)) {
        case 'served':
          totals.served = Number(row.count);
          break;
        case 'dismissed':
          totals.dismissed = Number(row.count);
          break;
        case 'request_sent':
          totals.requestSent = Number(row.count);
          break;
        case 'accepted':
          totals.accepted = Number(row.count);
          break;
      }
    }

    const denominatorFromServed = totals.served || 1;
    const denominatorFromRequests = totals.requestSent || 1;

    return {
      windowStart: since.toISOString(),
      windowEnd: new Date().toISOString(),
      totals,
      rates: {
        dismissFromServed: totals.dismissed / denominatorFromServed,
        requestSentFromServed: totals.requestSent / denominatorFromServed,
        acceptFromServed: totals.accepted / denominatorFromServed,
        acceptFromRequests: totals.accepted / denominatorFromRequests,
      },
      sources: sourceRows.map((row: Record<string, unknown>) => ({
        source: String(
          row.source,
        ) as FriendRecommendationAnalyticsSource,
        served: Number(row.served),
        dismissed: Number(row.dismissed),
        requestSent: Number(row.requestSent),
        accepted: Number(row.accepted),
      })),
    };
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
