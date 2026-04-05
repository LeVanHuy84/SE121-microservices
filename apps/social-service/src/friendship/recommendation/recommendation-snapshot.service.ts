import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import type { FriendRecommendation } from '../repositories/social-graph.repository';

export interface RecommendationSnapshotPage<T extends FriendRecommendation> {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
  startIndex: number;
}

interface RecommendationSnapshotPayload<T extends FriendRecommendation> {
  userId: string;
  recommendations: T[];
  continuationGraphCursor: string | null;
}

@Injectable()
export class RecommendationSnapshotService {
  private readonly ttlSeconds = 10 * 60;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async createSnapshotPage<T extends FriendRecommendation>(
    userId: string,
    recommendations: T[],
    limit: number,
    continuationGraphCursor: string | null,
  ): Promise<RecommendationSnapshotPage<T>> {
    if (recommendations.length === 0) {
      return {
        data: [],
        nextCursor: null,
        hasNextPage: false,
        startIndex: 0,
      };
    }

    const snapshotId = randomUUID();
    const payload: RecommendationSnapshotPayload<T> = {
      userId,
      recommendations,
      continuationGraphCursor,
    };
    await this.redis.set(
      this.getRedisKey(snapshotId),
      JSON.stringify(payload),
      'EX',
      this.ttlSeconds,
    );

    return this.buildPage(
      snapshotId,
      recommendations,
      0,
      limit,
      continuationGraphCursor,
    );
  }

  async getSnapshotPage<T extends FriendRecommendation>(
    userId: string,
    cursor: string,
    limit: number,
  ): Promise<RecommendationSnapshotPage<T> | null> {
    const decoded = this.decodeCursor(cursor);
    if (!decoded || decoded.type !== 'snapshot') {
      return null;
    }

    const payloadRaw = await this.redis.get(this.getRedisKey(decoded.snapshotId));
    if (!payloadRaw) {
      return null;
    }

    const payload = JSON.parse(
      payloadRaw,
    ) as RecommendationSnapshotPayload<T>;
    if (payload.userId !== userId || !Array.isArray(payload.recommendations)) {
      return null;
    }

    return this.buildPage(
      decoded.snapshotId,
      payload.recommendations,
      decoded.startIndex,
      limit,
      payload.continuationGraphCursor,
    );
  }

  getGraphContinuationCursor(cursor: string): string | null {
    const decoded = this.decodeCursor(cursor);
    if (!decoded || decoded.type !== 'graph') {
      return null;
    }

    return decoded.graphCursor;
  }

  private buildPage<T extends FriendRecommendation>(
    snapshotId: string,
    recommendations: T[],
    startIndex: number,
    limit: number,
    continuationGraphCursor: string | null,
  ): RecommendationSnapshotPage<T> {
    const safeStartIndex = Math.max(0, startIndex);
    const safeLimit = Math.max(1, Math.floor(limit));
    const data = recommendations.slice(safeStartIndex, safeStartIndex + safeLimit);
    const nextIndex = safeStartIndex + data.length;
    const hasNextPage =
      nextIndex < recommendations.length || Boolean(continuationGraphCursor);

    return {
      data,
      nextCursor:
        nextIndex < recommendations.length
          ? this.encodeSnapshotCursor(snapshotId, nextIndex)
          : continuationGraphCursor
            ? this.encodeGraphCursor(continuationGraphCursor)
            : null,
      hasNextPage,
      startIndex: safeStartIndex,
    };
  }

  private getRedisKey(snapshotId: string): string {
    return `friend-recommendation:snapshot:${snapshotId}`;
  }

  private encodeSnapshotCursor(snapshotId: string, startIndex: number): string {
    return Buffer.from(
      JSON.stringify({ type: 'snapshot', snapshotId, startIndex }),
      'utf8',
    ).toString('base64url');
  }

  private encodeGraphCursor(graphCursor: string): string {
    return Buffer.from(
      JSON.stringify({ type: 'graph', graphCursor }),
      'utf8',
    ).toString('base64url');
  }

  private decodeCursor(
    cursor: string,
  ):
    | { type: 'snapshot'; snapshotId: string; startIndex: number }
    | { type: 'graph'; graphCursor: string }
    | null {
    try {
      const decoded = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as {
        type?: unknown;
        snapshotId?: unknown;
        startIndex?: unknown;
        graphCursor?: unknown;
      };

      if (decoded.type === 'graph') {
        if (typeof decoded.graphCursor !== 'string') {
          return null;
        }

        return {
          type: 'graph',
          graphCursor: decoded.graphCursor,
        };
      }

      if (
        decoded.type !== 'snapshot' ||
        typeof decoded.snapshotId !== 'string' ||
        typeof decoded.startIndex !== 'number' ||
        !Number.isFinite(decoded.startIndex)
      ) {
        return null;
      }

      return {
        type: 'snapshot',
        snapshotId: decoded.snapshotId,
        startIndex: Math.max(0, Math.floor(decoded.startIndex)),
      };
    } catch {
      return null;
    }
  }
}
