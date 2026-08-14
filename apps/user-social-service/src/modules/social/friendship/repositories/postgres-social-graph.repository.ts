import { InjectRedis } from "@nestjs-modules/ioredis";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ActivityType,
  CursorPageResponse,
  CursorPaginationDTO,
  RecommendationGraphEventType,
} from "@repo/dtos";
import Redis from "ioredis";
import { OutboxService } from "src/modules/event/outbox.service";
import { DRIZZLE } from "src/drizzle/drizzle.module";
import type { DrizzleDB } from "src/drizzle/types/drizzle.d";
import {
  friendships,
  friendRequests,
  userBlocks,
  friendRecommendationDismissals,
  friendRecommendationEvents,
} from "src/drizzle/schema/schema";
import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import {
  AcceptedFriendRequestAttribution,
  FriendRecommendation,
  FriendRecommendationAttribution,
  FriendRecommendationEvent,
  SocialGraphRepository,
} from "./social-graph.repository";

@Injectable()
export class PostgresSocialGraphRepository implements SocialGraphRepository {
  private readonly logger = new Logger(PostgresSocialGraphRepository.name);
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly outboxService: OutboxService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  private getFriendsKey(userId: string) {
    return `friends:${userId}`;
  }

  private getBlocksKey(userId: string) {
    return `blocks:${userId}`;
  }

  private readonly EMPTY_FLAG = "__EMPTY__";

  async getRelationshipStatus(userId: string, targetId: string) {
    const rows = await this.db.execute<{ status: string }>(
      sql`
      SELECT CASE
        WHEN EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = ${userId} AND ub.blocked_id = ${targetId})
             OR (ub.blocker_id = ${targetId} AND ub.blocked_id = ${userId})
        ) THEN 'BLOCKED'
        WHEN EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.user_id = ${userId} AND f.friend_id = ${targetId}
        ) THEN 'FRIEND'
        WHEN EXISTS (
          SELECT 1 FROM friend_requests fr
          WHERE fr.requester_id = ${userId} AND fr.receiver_id = ${targetId}
        ) THEN 'REQUESTED_OUT'
        WHEN EXISTS (
          SELECT 1 FROM friend_requests fr
          WHERE fr.requester_id = ${targetId} AND fr.receiver_id = ${userId}
        ) THEN 'REQUESTED_IN'
        ELSE 'NONE'
      END AS status
      `,
    );

    const row = rows.rows[0];
    if (row?.status) {
      return {
        status: row.status as
          | "BLOCKED"
          | "FRIEND"
          | "REQUESTED_OUT"
          | "REQUESTED_IN"
          | "NONE",
      };
    }

    return { status: "NONE" as const };
  }

  async sendFriendRequest(
    userId: string,
    targetId: string,
    attribution?: FriendRecommendationAttribution,
  ): Promise<{ created: boolean }> {
    return this.db.transaction(async (tx) => {
      try {
        await tx.insert(friendRequests).values({
          requesterId: userId,
          receiverId: targetId,
          recommendationId: attribution?.recommendationId ?? null,
          recommendationRequestId: attribution?.recommendationRequestId ?? null,
        });
      } catch (err) {
        return { created: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.FRIEND_REQUEST_SENT,
        this.buildGraphEventPayload(userId, targetId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.SEND_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.SEND_REQUEST,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: "user",
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
    return this.db.transaction(async (tx) => {
      const result = await tx
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, userId),
            eq(friendRequests.receiverId, targetId),
          ),
        );

      if (!result.rowCount) {
        return { removed: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.FRIEND_REQUEST_CANCELED,
        this.buildGraphEventPayload(userId, targetId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.CANCEL_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.CANCEL_REQUEST,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: "user",
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
    return this.db.transaction(async (tx) => {
      const [pendingRequest] = await tx
        .select()
        .from(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, requesterId),
            eq(friendRequests.receiverId, userId),
          ),
        )
        .limit(1);

      if (!pendingRequest) {
        return null;
      }

      await tx
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, requesterId),
            eq(friendRequests.receiverId, userId),
          ),
        );

      try {
        await tx.insert(friendships).values([
          { userId, friendId: requesterId, sentimentScore: 0 },
          { userId: requesterId, friendId: userId, sentimentScore: 0 },
        ]);
      } catch (err) {
        // Ignored
      }

      const timestamp = Date.now();
      await this.redis
        .pipeline()
        .zadd(this.getFriendsKey(userId), timestamp, requesterId)
        .zadd(this.getFriendsKey(requesterId), timestamp, userId)
        .zrem(this.getFriendsKey(userId), this.EMPTY_FLAG)
        .zrem(this.getFriendsKey(requesterId), this.EMPTY_FLAG)
        .exec();

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.FRIEND_REQUEST_ACCEPTED,
        this.buildGraphEventPayload(userId, requesterId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.ACCEPT_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.ACCEPT_REQUEST,
          targetId: requesterId,
          targetOwnerId: requesterId,
          metadata: {
            targetType: "user",
          },
          createdAt: new Date(),
        },
      );

      return {
        recommendationId: pendingRequest.recommendationId ?? null,
        recommendationRequestId: pendingRequest.recommendationRequestId ?? null,
      };
    });
  }

  async declineFriendRequest(
    userId: string,
    requesterId: string,
  ): Promise<{ removed: boolean }> {
    return this.db.transaction(async (tx) => {
      const result = await tx
        .delete(friendRequests)
        .where(
          and(
            eq(friendRequests.requesterId, requesterId),
            eq(friendRequests.receiverId, userId),
          ),
        );

      if (!result.rowCount) {
        return { removed: false };
      }

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.FRIEND_REQUEST_DECLINED,
        this.buildGraphEventPayload(userId, requesterId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.REJECT_REQUEST,
        {
          actorId: userId,
          activityType: ActivityType.REJECT_REQUEST,
          targetId: requesterId,
          targetOwnerId: requesterId,
          metadata: {
            targetType: "user",
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
    return this.db.transaction(async (tx) => {
      const result = await tx
        .delete(friendships)
        .where(
          sql`(user_id = ${userId} AND friend_id = ${friendId}) OR (user_id = ${friendId} AND friend_id = ${userId})`,
        );

      if (!result.rowCount) {
        return { removed: false };
      }

      await this.redis
        .pipeline()
        .zrem(this.getFriendsKey(userId), friendId)
        .zrem(this.getFriendsKey(friendId), userId)
        .exec();

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.FRIENDSHIP_REMOVED,
        this.buildGraphEventPayload(userId, friendId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.UNFRIEND,
        {
          actorId: userId,
          activityType: ActivityType.UNFRIEND,
          targetId: friendId,
          targetOwnerId: friendId,
          metadata: {
            targetType: "user",
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
    return this.db.transaction(async (tx) => {
      await tx
        .delete(friendships)
        .where(
          sql`(user_id = ${userId} AND friend_id = ${targetId}) OR (user_id = ${targetId} AND friend_id = ${userId})`,
        );

      await tx
        .delete(friendRequests)
        .where(
          sql`(requester_id = ${userId} AND receiver_id = ${targetId}) OR (requester_id = ${targetId} AND receiver_id = ${userId})`,
        );

      try {
        await tx
          .insert(userBlocks)
          .values({ blockerId: userId, blockedId: targetId });
      } catch (err) {
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
        tx,
        RecommendationGraphEventType.USER_BLOCKED,
        this.buildGraphEventPayload(userId, targetId) as any,
      );

      await this.outboxService.createUserActivityEvent(
        tx,
        ActivityType.USER_BLOCKED,
        {
          actorId: userId,
          activityType: ActivityType.USER_BLOCKED,
          targetId,
          targetOwnerId: targetId,
          metadata: {
            targetType: "user",
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
    return this.db.transaction(async (tx) => {
      const result = await tx
        .delete(userBlocks)
        .where(
          and(
            eq(userBlocks.blockerId, userId),
            eq(userBlocks.blockedId, targetId),
          ),
        );

      if (!result.rowCount) {
        return { removed: false };
      }

      await this.redis.zrem(this.getBlocksKey(userId), targetId);

      await this.outboxService.createRecommendationGraphEvent(
        tx,
        RecommendationGraphEventType.USER_UNBLOCKED,
        this.buildGraphEventPayload(userId, targetId) as any,
      );

      return { removed: true };
    });
  }

  async dismissFriendRecommendation(
    userId: string,
    candidateId: string,
    expiresAt: Date,
  ) {
    await this.db.transaction(async (tx) => {
      await tx
        .insert(friendRecommendationDismissals)
        .values({
          userId,
          candidateId,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: [
            friendRecommendationDismissals.userId,
            friendRecommendationDismissals.candidateId,
          ],
          set: { expiresAt },
        });

      await this.outboxService.createRecommendationGraphDismissedEvent(tx, {
        ...this.buildGraphEventPayload(userId, candidateId),
        expiresAt: expiresAt.toISOString(),
      } as any);
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
    let cachedFriends: string[];

    if (query.cursor) {
      const cursorScore = await this.redis.zscore(cacheKey, query.cursor);
      if (cursorScore) {
        cachedFriends = await this.redis.zrevrangebyscore(
          cacheKey,
          `(${cursorScore}`,
          "-inf",
          "LIMIT",
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
    const allFriends = await this.db
      .select({ friendId: friendships.friendId, since: friendships.since })
      .from(friendships)
      .where(eq(friendships.userId, userId));

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
    const conditions = [eq(friendRequests.receiverId, userId)];
    if (query.cursor) {
      conditions.push(gt(friendRequests.requesterId, query.cursor));
    }

    const rows = await this.db
      .select({ requesterId: friendRequests.requesterId })
      .from(friendRequests)
      .where(and(...conditions))
      .orderBy(asc(friendRequests.requesterId))
      .limit(query.limit + 1);

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

    const rows = await this.db.execute<{
      id: string;
      mutualFriends: number;
      mutualFriendIds: string[];
    }>(
      sql`
      WITH requested_candidates AS (
        SELECT UNNEST(${dedupedCandidateIds}::varchar[]) AS candidate_id
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
        ON viewer_friend.user_id = ${userId}
      LEFT JOIN friendships candidate_friend
        ON candidate_friend.user_id = rc.candidate_id
       AND candidate_friend.friend_id = viewer_friend.friend_id
      GROUP BY rc.candidate_id
      ORDER BY rc.candidate_id ASC
      `,
    );

    return rows.rows.map((row) => ({
      id: String(row.id),
      mutualFriends: Number(row.mutualFriends),
      mutualFriendIds: (row.mutualFriendIds ?? []).map((value: unknown) =>
        String(value),
      ),
    }));
  }

  async getFriendIds(userId: string, limit?: number): Promise<string[]> {
    const conditions = [eq(friendships.userId, userId)];

    const query = this.db
      .select({ friendId: friendships.friendId })
      .from(friendships)
      .where(and(...conditions))
      .orderBy(desc(friendships.since));

    if (typeof limit === "number") {
      query.limit(Math.max(0, Math.floor(limit)));
    }

    const rows = await query;
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
          "-inf",
          "LIMIT",
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
    const allBlocks = await this.db
      .select({
        blockedId: userBlocks.blockedId,
        createdAt: userBlocks.createdAt,
      })
      .from(userBlocks)
      .where(eq(userBlocks.blockerId, userId));

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
      recommendationId: event.recommendationId ?? undefined,
      recommendationRequestId: event.recommendationRequestId ?? undefined,
      metadata: event.metadata ?? undefined,
    }));

    await this.db.insert(friendRecommendationEvents).values(insertValues);
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
    const totalRows = await this.db.execute<{
      eventType: string;
      count: number;
    }>(
      sql`
      SELECT
        event_type AS "eventType",
        COUNT(*)::int AS count
      FROM friend_recommendation_events
      WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
        AND created_at >= ${since}
      GROUP BY event_type
      `,
    );

    const sourceRows = await this.db.execute<{
      source: string;
      served: number;
      dismissed: number;
      requestSent: number;
      accepted: number;
    }>(
      sql`
      WITH served AS (
        SELECT
          recommendation_id,
          COALESCE(metadata->>'source', metadata->>'candidateSourceMode') AS recorded_source
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'served'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      dismissed AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'dismissed'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      request_sent AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'request_sent'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      accepted AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'accepted'
          AND created_at >= ${since}
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
    );

    const candidateSourceModeRows = await this.db.execute<{
      candidateSourceMode: string;
      served: number;
      dismissed: number;
      requestSent: number;
      accepted: number;
    }>(
      sql`
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
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'served'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      dismissed AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'dismissed'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      request_sent AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'request_sent'
          AND created_at >= ${since}
          AND recommendation_id IS NOT NULL
      ),
      accepted AS (
        SELECT DISTINCT recommendation_id
        FROM friend_recommendation_events
        WHERE (${userId}::varchar IS NULL OR user_id = ${userId})
          AND event_type = 'accepted'
          AND created_at >= ${since}
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
    );

    const mappedTotals = totalRows.rows.reduce(
      (acc, r) => {
        acc[r.eventType] = r.count;
        return acc;
      },
      {} as Record<string, number>,
    );

    const servedTotal = mappedTotals["served"] || 0;
    const requestsTotal = mappedTotals["request_sent"] || 0;

    const rates = {
      dismissFromServed:
        servedTotal > 0 ? (mappedTotals["dismissed"] || 0) / servedTotal : 0,
      requestSentFromServed:
        servedTotal > 0 ? (mappedTotals["request_sent"] || 0) / servedTotal : 0,
      acceptFromServed:
        servedTotal > 0 ? (mappedTotals["accepted"] || 0) / servedTotal : 0,
      acceptFromRequests:
        requestsTotal > 0 ? (mappedTotals["accepted"] || 0) / requestsTotal : 0,
    };

    return {
      windowStart: since.toISOString(),
      windowEnd: new Date().toISOString(),
      totals: {
        served: servedTotal,
        dismissed: mappedTotals["dismissed"] || 0,
        requestSent: requestsTotal,
        accepted: mappedTotals["accepted"] || 0,
      },
      rates,
      sources: sourceRows.rows.map((row) => ({
        source: row.source as any,
        served: row.served,
        dismissed: row.dismissed,
        requestSent: row.requestSent,
        accepted: row.accepted,
      })),
      candidateSourceModes: candidateSourceModeRows.rows.map((row) => ({
        candidateSourceMode: row.candidateSourceMode as any,
        served: row.served,
        dismissed: row.dismissed,
        requestSent: row.requestSent,
        accepted: row.accepted,
      })),
    };
  }

  private buildGraphEventPayload(userId: string, targetId: string) {
    return {
      schemaVersion: "1.0",
      occurredAt: new Date().toISOString(),
      source: "social-graph",
      userId,
      targetUserId: targetId,
    };
  }

  private buildStringPage(
    data: string[],
    limit: number,
  ): CursorPageResponse<string> {
    const hasNextPage = data.length > limit;
    const items = hasNextPage ? data.slice(0, limit) : data;
    const nextCursor = hasNextPage ? items[items.length - 1] : null;

    return {
      data: items,
      nextCursor,
      hasNextPage,
    };
  }
}
