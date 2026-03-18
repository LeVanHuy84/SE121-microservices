import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import {
  CursorPageResponse,
  TrendingQuery,
  Emotion,
  ReactionType,
  TargetType,
} from '@repo/dtos';
import { SnapshotMapper } from 'src/common/snapshot.mapper';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RankingService } from '../../ranking/services/ranking.service';
import { RankingCandidate } from '../../ranking/interfaces/ranking-strategy.interface';

@Injectable()
export class TrendingService {
  private readonly logger = new Logger(TrendingService.name);

  private readonly trendingCandidateFactor = 2;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    private readonly rankingService: RankingService,
  ) {}

  async getTrendingPosts(query: TrendingQuery, userId: string) {
    if (query.mainEmotion) {
      return this.getEmotionTrendingPosts(query, userId);
    }

    return this.getDefaultTrendingPosts(query, userId);
  }

  /**
   * =========================================
   * DEFAULT TRENDING (WITH RANKING SERVICE)
   * =========================================
   */
  private async getDefaultTrendingPosts(query: TrendingQuery, userId: string) {
    const { cursor, limit = 10 } = query;

    const effectiveKey = 'post:score';

    let maxScore = '+inf';
    let cursorTuple:
      | { score: number; createdAt: number; postId?: string }
      | undefined;

    if (cursor) {
      const [scoreStr, createdAtStr, postId] = cursor.split('_');
      const score = parseFloat(scoreStr);
      const createdAt = Number(createdAtStr);

      if (Number.isFinite(score)) {
        maxScore = `${score}`;
      }

      if (Number.isFinite(score) && Number.isFinite(createdAt)) {
        cursorTuple = {
          score,
          createdAt,
          postId: postId || undefined,
        };
      }
    }

    const candidateLimit = limit * this.trendingCandidateFactor;
    const fetchLimit = candidateLimit * 3 + 1;

    const rawCandidates = await this.redis.zrevrangebyscore(
      effectiveKey,
      maxScore,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      fetchLimit,
    );

    if (!rawCandidates.length) {
      return new CursorPageResponse([], null, false);
    }

    const baseScoredItems: Array<{ postId: string; baseScore: number }> = [];

    for (let i = 0; i < rawCandidates.length; i += 2) {
      const postId = rawCandidates[i];
      const baseScore = Number(rawCandidates[i + 1]);

      if (!postId || !Number.isFinite(baseScore)) continue;

      baseScoredItems.push({ postId, baseScore });
    }

    const postsFromDB = await this.snapshotRepo.findPostsByIds(
      baseScoredItems.map((item) => item.postId),
    );

    const snapshotMap = new Map(postsFromDB.map((p) => [String(p.postId), p]));

    const orderedCandidates = baseScoredItems
      .map((item) => {
        const snapshot = snapshotMap.get(item.postId);
        if (!snapshot) return null;

        return {
          postId: item.postId,
          snapshot,
          baseScore: item.baseScore,
          timestamp: snapshot.postCreatedAt || new Date(),
        };
      })
      .filter((item): item is RankingCandidate => item != null)
      .sort((a, b) => {
        if (b.baseScore !== a.baseScore) return b.baseScore - a.baseScore;

        const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
        if (timeDiff !== 0) return timeDiff;

        return b.postId.localeCompare(a.postId);
      });

    const candidates = cursorTuple
      ? orderedCandidates.filter((item) =>
          this.isAfterCursorInBaseOrder(item, cursorTuple!),
        )
      : orderedCandidates;

    const retrievedCandidates = candidates.slice(0, candidateLimit);

    const rankedItems = await this.rankingService.rankForTrending(
      retrievedCandidates,
      userId,
    );

    const topItems = rankedItems.slice(0, limit);

    return this.buildResponse(
      topItems,
      retrievedCandidates,
      candidates,
      limit,
      userId,
    );
  }

  /**
   * =========================================
   * EMOTION TRENDING (NO RANKING)
   * =========================================
   */
  private async getEmotionTrendingPosts(query: TrendingQuery, userId?: string) {
    const { cursor, limit = 10, mainEmotion } = query;

    const emotionKey = `post:emotion:${mainEmotion!.toLowerCase()}:score`;

    const exists = await this.redis.exists(emotionKey);
    if (!exists) {
      return new CursorPageResponse([], null, false);
    }

    let maxScore = '+inf';

    if (cursor) {
      const [score] = cursor.split('_');
      if (Number.isFinite(Number(score))) {
        maxScore = score;
      }
    }

    const rawCandidates = await this.redis.zrevrangebyscore(
      emotionKey,
      maxScore,
      '-inf',
      'WITHSCORES',
      'LIMIT',
      0,
      limit + 1,
    );

    if (!rawCandidates.length) {
      return new CursorPageResponse([], null, false);
    }

    const items: { postId: string; baseScore: number }[] = [];

    for (let i = 0; i < rawCandidates.length; i += 2) {
      const postId = rawCandidates[i];
      const score = Number(rawCandidates[i + 1]);

      if (!postId || !Number.isFinite(score)) continue;

      items.push({
        postId,
        baseScore: score,
      });
    }

    const postIds = items.slice(0, limit).map((i) => i.postId);

    const snapshots = await this.snapshotRepo.findPostsByIds(postIds);

    const reactions = await this.fetchUserReactions(userId, postIds);

    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(snapshots, reactions);

    let nextCursor: string | null = null;
    const hasMore = items.length > limit;

    if (hasMore) {
      const last = items[limit - 1];
      nextCursor = `${last.baseScore}_${Date.now()}_${last.postId}`;
    }

    return new CursorPageResponse(dtoPosts, nextCursor, hasMore);
  }

  /**
   * =========================================
   * COMMON RESPONSE BUILDER
   * =========================================
   */
  private async buildResponse(
    topItems: RankingCandidate[],
    retrievedCandidates: RankingCandidate[],
    candidates: RankingCandidate[],
    limit: number,
    userId?: string,
  ) {
    if (!topItems.length) {
      return new CursorPageResponse([], null, false);
    }

    const reactions = await this.fetchUserReactions(
      userId,
      topItems.map((i) => i.postId),
    );

    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(
      topItems.map((i) => i.snapshot),
      reactions,
    );

    const frontier = retrievedCandidates[retrievedCandidates.length - 1];

    const createdAt = frontier.timestamp.getTime();

    const nextCursor = `${frontier.baseScore}_${createdAt}_${frontier.postId}`;

    const hasMore = candidates.length > retrievedCandidates.length;

    return new CursorPageResponse(dtoPosts, nextCursor, hasMore);
  }

  private async fetchUserReactions(
    userId: string | undefined,
    postIds: string[],
  ): Promise<Record<string, ReactionType>> {
    if (!userId) return {};

    try {
      return await firstValueFrom(
        this.postClient.send<Record<string, ReactionType>>(
          'get_reacted_types_batch',
          {
            userId,
            targetType: TargetType.POST,
            targetIds: postIds,
          },
        ),
      );
    } catch {
      this.logger.warn('Failed to fetch reactions');
      return {};
    }
  }

  private isAfterCursorInBaseOrder(
    item: RankingCandidate,
    cursor: { score: number; createdAt: number; postId?: string },
  ): boolean {
    if (item.baseScore < cursor.score) return true;
    if (item.baseScore > cursor.score) return false;

    const itemCreatedAt = item.timestamp.getTime();

    if (itemCreatedAt < cursor.createdAt) return true;
    if (itemCreatedAt > cursor.createdAt) return false;

    if (!cursor.postId) return false;

    return item.postId.localeCompare(cursor.postId) < 0;
  }
}
