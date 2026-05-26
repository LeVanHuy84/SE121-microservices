import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ActivityType,
  CursorPaginationDTO,
  CursorPageResponse,
  RecommendationGraphEventType,
} from '@repo/dtos';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { FriendRecommendationEventEntity } from 'src/postgres/entities/friend-recommendation-event.entity';
import { FriendRequestEntity } from 'src/postgres/entities/friend-request.entity';
import { FriendshipEntity } from 'src/postgres/entities/friendship.entity';
import { FriendRecommendationDismissalEntity } from 'src/postgres/entities/friend-recommendation-dismissal.entity';
import { UserBlockEntity } from 'src/postgres/entities/user-block.entity';
import { OutboxService } from 'src/event/outbox.service';
import {
  AcceptedFriendRequestAttribution,
  FriendRecommendationAnalyticsCandidateSourceMode,
  FriendRecommendationAnalyticsSource,
  FriendRecommendationAttribution,
  FriendRecommendationEvent,
  FriendRecommendation,
  SocialGraphRepository,
} from './social-graph.repository';

@Injectable()
export class PostgresSocialGraphRepository implements SocialGraphRepository {
  private readonly logger = new Logger(PostgresSocialGraphRepository.name);
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
    private readonly recommendationDismissalRepo: Repository<FriendRecommendationDismissalEntity>,
    private readonly outboxService: OutboxService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  private getFriendsKey(userId: string) {
    return `friends:${userId}`;
  }

  private getBlocksKey(userId: string) {
    return `blocks:${userId}`;
  }

  private readonly EMPTY_FLAG = '__EMPTY__';

  async getRelationshipStatus(userId: string, targetId: string) {
    const [row] = await this.dataSource.query(
      `
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = $1 AND ub.blocked_id = $2)
             OR (ub.blocker_id = $2 AND ub.blocked_id = $1)
        ) THEN 'BLOCKED'
        WHEN EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.user_id = $1 AND f.friend_id = $2
        ) THEN 'FRIEND'
        WHEN EXISTS (
          SELECT 1 FROM friend_requests fr
          WHERE fr.requester_id = $1 AND fr.receiver_id = $2
        ) THEN 'REQUESTED_OUT'
        WHEN EXISTS (
          SELECT 1 FROM friend_requests fr
          WHERE fr.requester_id = $2 AND fr.receiver_id = $1
        ) THEN 'REQUESTED_IN'
        ELSE 'NONE'
      END AS status
      `,
      [userId, targetId],
    );

    if (row?.status) {
      return {
        status: row.status as
          | 'BLOCKED'
          | 'FRIEND'
          | 'REQUESTED_OUT'
          | 'REQUESTED_IN'
          | 'NONE',
      };
    }

    return { status: 'NONE' as const };
  }

  async sendFriendRequest(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ): Promise<{ created: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const insertResult = await manager
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

      if ((insertResult.identifiers?.length ?? 0) === 0) {
        return { created: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.FRIEND_REQUEST_SENT,
        this.buildGraphEventPayload(userId, targetId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.SEND_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.SEND_REQUEST,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return { created: true };
    });
  }

  async cancelFriendRequest(
    userId: string,
    targetId: string,
  ): Promise<{ removed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(FriendRequestEntity, {
        requesterId: userId,
        receiverId: targetId,
      });

      if (!deleteResult.affected) {
        return { removed: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.FRIEND_REQUEST_CANCELED,
        this.buildGraphEventPayload(userId, targetId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.CANCEL_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.CANCEL_REQUEST,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return { removed: true };
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

      if (!pendingRequest) {
        return null;
      }

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

      const timestamp = Date.now();
      await this.redis
        .pipeline()
        .zadd(this.getFriendsKey(userId), timestamp, requesterId)
        .zadd(this.getFriendsKey(requesterId), timestamp, userId)
        .zrem(this.getFriendsKey(userId), this.EMPTY_FLAG)
        .zrem(this.getFriendsKey(requesterId), this.EMPTY_FLAG)
        .exec();

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED,
        this.buildGraphEventPayload(userId, requesterId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.ACCEPT_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.ACCEPT_REQUEST,
          targetId: requesterId,
          targetOwnerId: requesterId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return pendingRequest
        ? {
            recommendationId: pendingRequest.recommendationId ?? null,
            recommendationRequestId:
              pendingRequest.recommendationRequestId ?? null,
          }
        : null;
    });
  }

  async declineFriendRequest(
    userId: string,
    requesterId: string,
  ): Promise<{ removed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(FriendRequestEntity, {
        requesterId,
        receiverId: userId,
      });

      if (!deleteResult.affected) {
        return { removed: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.FRIEND_REQUEST_DECLINED,
        this.buildGraphEventPayload(userId, requesterId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.REJECT_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.REJECT_REQUEST,
          targetId: requesterId,
          targetOwnerId: requesterId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return { removed: true };
    });
  }

  async removeFriend(
    userId: string,
    friendId: string,
  ): Promise<{ removed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(FriendshipEntity, [
        { userId, friendId },
        { userId: friendId, friendId: userId },
      ]);

      if (!deleteResult.affected) {
        return { removed: false };
      }

      await this.redis
        .pipeline()
        .zrem(this.getFriendsKey(userId), friendId)
        .zrem(this.getFriendsKey(friendId), userId)
        .exec();

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.FRIENDSHIP_REMOVED,
        this.buildGraphEventPayload(userId, friendId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.UNFRIEND,
        {
          actorId: userId,
          activityType: ActivityType.UNFRIEND,
          targetId: friendId,
          targetOwnerId: friendId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return { removed: true };
    });
  }

  async blockUser(
    userId: string,
    targetId: string,
  ): Promise<{ created: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      await manager.delete(FriendshipEntity, [
        { userId, friendId: targetId },
        { userId: targetId, friendId: userId },
      ]);

      await manager.delete(FriendRequestEntity, [
        { requesterId: userId, receiverId: targetId },
        { requesterId: targetId, receiverId: userId },
      ]);

      const insertResult = await manager
        .createQueryBuilder()
        .insert()
        .into(UserBlockEntity)
        .values({ blockerId: userId, blockedId: targetId })
        .orIgnore()
        .execute();

      if ((insertResult.identifiers?.length ?? 0) === 0) {
        return { created: false };
      }

      const timestamp = Date.now();
      await this.redis
        .pipeline()
        .zrem(this.getFriendsKey(userId), targetId)
        .zrem(this.getFriendsKey(targetId), userId)
        .zadd(this.getBlocksKey(userId), timestamp, targetId)
        .zrem(this.getBlocksKey(userId), this.EMPTY_FLAG)
        .exec();

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.USER_BLOCKED,
        this.buildGraphEventPayload(userId, targetId),
      );

      await this.outboxService.createUserActivityEvent(
        manager,
        ActivityType.USER_BLOCKED,
        {
          actorId: userId,
          activityType: ActivityType.USER_BLOCKED,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: 'user',
          },
          createdAt: new Date(),
        },
      );

      return { created: true };
    });
  }

  async unblockUser(
    userId: string,
    targetId: string,
  ): Promise<{ removed: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const deleteResult = await manager.delete(UserBlockEntity, {
        blockerId: userId,
        blockedId: targetId,
      });

      if (!deleteResult.affected) {
        return { removed: false };
      }

      await this.redis.zrem(this.getBlocksKey(userId), targetId);

      await this.outboxService.createRecommendationGraphEvent(
        manager,
        RecommendationGraphEventType.USER_UNBLOCKED,
        this.buildGraphEventPayload(userId, targetId),
      );

      return { removed: true };
    });
  }

  async dismissFriendRecommendation(
    userId: string,
    candidateId: string,
    expiresAt: Date,
  ) {
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(FriendRecommendationDismissalEntity).upsert(
        {
          userId,
          candidateId,
          expiresAt,
        },
        ['userId', 'candidateId'],
      );

      await this.outboxService.createRecommendationGraphDismissedEvent(
        manager,
        {
          ...this.buildGraphEventPayload(userId, candidateId),
          expiresAt: expiresAt.toISOString(),
        },
      );
    });
  }

  async getFriends(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<string>> {
    const cacheKey = this.getFriendsKey(userId);
    const cacheExists = await this.redis.exists(cacheKey);

    if (!cacheExists) {
      await this.rebuildFriendsCache(userId);
    }

    const limit = query.limit;
    // ZREVRANGEBYSCORE with max, min, LIMIT offset, count
    let cachedFriends: string[];

    if (query.cursor) {
      // Find the score of the cursor to paginate from
      const cursorScore = await this.redis.zscore(cacheKey, query.cursor);
      if (cursorScore) {
        // Exclude the cursor itself by subtracting a tiny amount, but Redis ZREVRANGEBYSCORE allows exclusive ranges using '('
        cachedFriends = await this.redis.zrevrangebyscore(
          cacheKey,
          `(${cursorScore}`,
          '-inf',
          'LIMIT',
          0,
          limit + 1,
        );
      } else {
        cachedFriends = [];
      }
    } else {
      cachedFriends = await this.redis.zrevrange(cacheKey, 0, limit);
    }

    cachedFriends = cachedFriends.filter((id) => id !== this.EMPTY_FLAG);

    return this.buildStringPage(cachedFriends, limit);
  }

  private async rebuildFriendsCache(userId: string): Promise<void> {
    const allFriends = await this.friendshipRepo.find({
      where: { userId },
      select: { friendId: true, since: true },
    });

    const pipeline = this.redis.pipeline();
    const cacheKey = this.getFriendsKey(userId);

    if (allFriends.length === 0) {
      pipeline.zadd(cacheKey, 0, this.EMPTY_FLAG);
    } else {
      for (const f of allFriends) {
        pipeline.zadd(cacheKey, f.since.getTime(), f.friendId);
      }
    }

    pipeline.expire(cacheKey, 604800); // 7 days TTL
    await pipeline.exec();
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
    const cacheKey = this.getBlocksKey(userId);
    const cacheExists = await this.redis.exists(cacheKey);

    if (!cacheExists) {
      await this.rebuildBlocksCache(userId);
    }

    const limit = query.limit;
    let cachedBlocks: string[];

    if (query.cursor) {
      const cursorScore = await this.redis.zscore(cacheKey, query.cursor);
      if (cursorScore) {
        cachedBlocks = await this.redis.zrevrangebyscore(
          cacheKey,
          `(${cursorScore}`,
          '-inf',
          'LIMIT',
          0,
          limit + 1,
        );
      } else {
        cachedBlocks = [];
      }
    } else {
      cachedBlocks = await this.redis.zrevrange(cacheKey, 0, limit);
    }

    cachedBlocks = cachedBlocks.filter((id) => id !== this.EMPTY_FLAG);

    return this.buildStringPage(cachedBlocks, limit);
  }

  private async rebuildBlocksCache(userId: string): Promise<void> {
    const allBlocks = await this.userBlockRepo.find({
      where: { blockerId: userId },
      select: { blockedId: true, createdAt: true },
    });

    const pipeline = this.redis.pipeline();
    const cacheKey = this.getBlocksKey(userId);

    if (allBlocks.length === 0) {
      pipeline.zadd(cacheKey, 0, this.EMPTY_FLAG);
    } else {
      for (const b of allBlocks) {
        pipeline.zadd(cacheKey, b.createdAt.getTime(), b.blockedId);
      }
    }

    pipeline.expire(cacheKey, 604800); // 7 days TTL
    await pipeline.exec();
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
      metadata: (event.metadata ??
        null) as FriendRecommendationEventEntity['metadata'],
    }));

    await this.recommendationEventRepo.insert(
      insertValues as Parameters<typeof this.recommendationEventRepo.insert>[0],
    );
  }

  async getFriendRecommendationAnalytics(userId: string, since: Date) {
    return this.getFriendRecommendationAnalyticsForScope(userId, since);
  }

  async getGlobalFriendRecommendationAnalytics(since: Date) {
    return this.getFriendRecommendationAnalyticsForScope(null, since);
  }

  private async getFriendRecommendationAnalyticsForScope(
    userId: string | null,
    since: Date,
  ) {
    const totalRows = await this.dataSource.query(
      `
      SELECT
        event_type AS "eventType",
        COUNT(*)::int AS count
      FROM friend_recommendation_events
      WHERE ($1::varchar IS NULL OR user_id = $1)
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
          COALESCE(metadata->>'source', metadata->>'candidateSourceMode') AS recorded_source
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'served'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      dismissed AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'dismissed'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      request_sent AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'request_sent'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      accepted AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'accepted'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      served_with_source AS (
        SELECT
          recommendation_id,
          CASE
            WHEN recorded_source IN (
              'online',
              'hybrid',
              'fallback'
            ) THEN recorded_source
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

    const candidateSourceModeRows = await this.dataSource.query(
      `
      WITH served AS (
        SELECT
          recommendation_id,
          CASE
            WHEN metadata->>'candidateSourceMode' IN (
              'online',
              'hybrid',
              'fallback'
            ) THEN metadata->>'candidateSourceMode'
            ELSE 'fallback'
          END AS candidate_source_mode
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'served'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      dismissed AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'dismissed'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      request_sent AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'request_sent'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      ),
      accepted AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE ($1::varchar IS NULL OR user_id = $1)
          AND event_type = 'accepted'
          AND created_at >= $2
          AND recommendation_id IS NOT NULL
      )
      SELECT
        candidate_source_mode AS "candidateSourceMode",
        COUNT(*)::int AS served,
        COUNT(dismissed.recommendation_id)::int AS dismissed,
        COUNT(request_sent.recommendation_id)::int AS "requestSent",
        COUNT(accepted.recommendation_id)::int AS accepted
      FROM served
      LEFT JOIN dismissed
        ON dismissed.recommendation_id = served.recommendation_id
      LEFT JOIN request_sent
        ON request_sent.recommendation_id = served.recommendation_id
      LEFT JOIN accepted
        ON accepted.recommendation_id = served.recommendation_id
      GROUP BY candidate_source_mode
      ORDER BY candidate_source_mode ASC
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
        source: String(row.source) as FriendRecommendationAnalyticsSource,
        served: Number(row.served),
        dismissed: Number(row.dismissed),
        requestSent: Number(row.requestSent),
        accepted: Number(row.accepted),
      })),
      candidateSourceModes: candidateSourceModeRows.map(
        (row: Record<string, unknown>) => ({
          candidateSourceMode: String(
            row.candidateSourceMode,
          ) as FriendRecommendationAnalyticsCandidateSourceMode,
          served: Number(row.served),
          dismissed: Number(row.dismissed),
          requestSent: Number(row.requestSent),
          accepted: Number(row.accepted),
        }),
      ),
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

  private buildGraphEventPayload(userId: string, targetUserId: string) {
    return {
      userId,
      targetUserId,
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      source: 'social-service' as const,
    };
  }
}
