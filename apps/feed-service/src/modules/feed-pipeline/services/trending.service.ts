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
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { SnapshotMapper } from 'src/common/snapshot.mapper';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { RankingService } from '../../ranking/services/ranking.service';
import { RankingCandidate } from '../../ranking/interfaces/ranking-strategy.interface';

@Injectable()
export class TrendingService {
  private readonly logger = new Logger(TrendingService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy,
    private readonly rankingService: RankingService, // ⭐ Inject RankingService
  ) {}

  private async getEffectiveKey(emotion?: Emotion): Promise<string | null> {
    if (!emotion) return 'post:score';

    // ✅ Dùng ZSET với intensity score (thay vì SET)
    const emotionKey = `post:emotion:${emotion.toLowerCase()}:score`;
    const exists = await this.redis.exists(emotionKey);

    if (!exists) return null;

    const tempKey = `post:score:tmp:${emotion.toLowerCase()}`;

    // ZINTERSTORE với WEIGHTS để combine ranking score + emotion intensity
    await this.redis.zinterstore(
      tempKey,
      2,
      'post:score',
      emotionKey,
      'WEIGHTS',
      1, // post:score weight = 1 (engagement-based)
      0.3, // ⭐ emotion intensity weight = 0.3 (boost by intensity)
    );

    await this.redis.expire(tempKey, 5);
    return tempKey;
  }

  /**
   * 🔥 Lấy danh sách bài trending (với RankingService)
   * Cursor = `${finalScore}_${createdAt}`
   */
  async getTrendingPosts(query: TrendingQuery, userId?: string) {
    const { cursor, limit = 10, mainEmotion } = query;

    // ✅ Lấy key phù hợp (có filter emotion hoặc không)
    const effectiveKey = await this.getEffectiveKey(mainEmotion);
    if (!effectiveKey) {
      return new CursorPageResponse([], null, false);
    }

    // ------------------------------
    // 1️⃣ Parse cursor
    // ------------------------------
    let maxScore = '+inf';

    if (cursor) {
      const [scoreStr] = cursor.split('_');
      const score = parseFloat(scoreStr);
      maxScore = `(${score}`;
    }

    // ------------------------------
    // 2️⃣ Lấy top N*3 candidates từ Redis (để re-rank)
    // ------------------------------
    const candidateLimit = limit * 3; // over-fetch để đủ sau khi re-rank
    const ids = await this.redis.zrevrangebyscore(
      effectiveKey,
      maxScore,
      '-inf',
      'LIMIT',
      0,
      candidateLimit,
    );

    if (!ids.length) {
      return new CursorPageResponse([], null, false);
    }

    // ------------------------------
    // 3️⃣ Load snapshots từ DB
    // ------------------------------
    const postsFromDB = await this.snapshotRepo.findPostsByIds(ids);
    const snapshotMap = new Map(postsFromDB.map((p) => [String(p.postId), p]));

    // Preserve order từ Redis
    const orderedSnapshots = ids
      .map((id) => snapshotMap.get(id))
      .filter((p): p is PostSnapshot => p != null);

    if (!orderedSnapshots.length) {
      return new CursorPageResponse([], null, false);
    }

    // ------------------------------
    // 4️⃣ Convert sang RankingCandidates & Re-rank
    // ------------------------------
    const candidates: RankingCandidate[] = await Promise.all(
      orderedSnapshots.map(async (snapshot) => {
        // Get base score từ Redis
        const baseScore =
          (await this.redis.zscore(effectiveKey, snapshot.postId)) || 0;

        return {
          postId: snapshot.postId,
          snapshot,
          baseScore: parseFloat(baseScore as any),
          timestamp: snapshot.postCreatedAt || new Date(),
        };
      }),
    );

    // ⭐ Re-rank với RankingService
    const rankedItems = await this.rankingService.rankForTrending(
      candidates,
      mainEmotion,
    );

    // Take top limit items
    const topItems = rankedItems.slice(0, limit);

    if (!topItems.length) {
      return new CursorPageResponse([], null, false);
    }

    this.logger.debug(
      `Trending re-ranked: ${candidates.length} → ${topItems.length} (emotion=${mainEmotion || 'all'})`,
    );

    // ------------------------------
    // 5️⃣ Lấy reaction của user
    // ------------------------------
    let reactions: Record<string, ReactionType> = {};
    if (userId) {
      try {
        reactions = await firstValueFrom(
          this.postClient.send<Record<string, ReactionType>>(
            'get_reacted_types_batch',
            {
              userId,
              targetType: TargetType.POST,
              targetIds: topItems.map((item) => item.postId),
            },
          ),
        );
      } catch (err) {
        this.logger.warn(
          '⚠️ Failed to fetch reactions, continuing without them',
        );
      }
    }

    // ------------------------------
    // 6️⃣ Map sang DTO
    // ------------------------------
    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(
      topItems.map((item) => item.snapshot),
      reactions,
    );

    // ------------------------------
    // 7️⃣ Tính nextCursor
    // ------------------------------
    let nextCursor: string | null = null;
    const hasMore = rankedItems.length > limit;

    if (hasMore) {
      const last = topItems[topItems.length - 1];
      const createdAt = last.timestamp.getTime();
      nextCursor = `${last.finalScore}_${createdAt}`;
    }

    return new CursorPageResponse(dtoPosts, nextCursor, hasMore);
  }
}
