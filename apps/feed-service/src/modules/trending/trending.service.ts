import { Injectable, Inject } from '@nestjs/common';
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
import { CacheLayerService } from '../cache-layer/cache-layer.service';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TrendingService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotCache: CacheLayerService,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy, // 👈 thêm dòng này
  ) {}

  private getKey(mainEmotion?: Emotion): string {
    return mainEmotion
      ? `post:score:emotion:${mainEmotion.toLowerCase()}`
      : 'post:score';
  }

  /**
   * 🔥 Lấy danh sách bài trending (cursor pagination chuẩn)
   * Cursor = `${rankingScore}_${createdAt}`
   */
  async getTrendingPosts(query: TrendingQuery, userId?: string) {
    const { cursor, limit = 10, mainEmotion } = query;
    const key = this.getKey(mainEmotion);

    // Nếu key emotion chưa tồn tại thì fallback về key tổng
    const exists = await this.redis.exists(key);
    const effectiveKey = exists ? key : 'post:score';

    // ------------------------------
    // 1️⃣ Parse cursor
    // ------------------------------
    let maxScore = '+inf'; // bắt đầu từ bài có score cao nhất
    let minScore = '-inf';

    if (cursor) {
      const [scoreStr] = cursor.split('_');
      const score = parseFloat(scoreStr);
      maxScore = `(${score}`; // exclude bài cuối cùng của trang trước
    }

    // ------------------------------
    // 2️⃣ Lấy danh sách postId theo score
    // ------------------------------
    const ids = await this.redis.zrevrangebyscore(
      effectiveKey,
      maxScore,
      minScore,
      'LIMIT',
      0,
      limit,
    );

    if (!ids.length) {
      return new CursorPageResponse([], null, false);
    }

    // ------------------------------
    // 3️⃣ Lấy snapshot từ cache hoặc DB
    // ------------------------------
    const postCache = await this.snapshotCache.getPostBatch(ids);
    const missingIds = ids.filter((id) => !postCache.has(id));

    const postsFromDB = missingIds.length
      ? await this.snapshotRepo.findPostsByIds(missingIds)
      : [];

    if (postsFromDB.length) {
      await this.snapshotCache.setPostBatch(postsFromDB);
    }

    const allPosts = [...postCache.values(), ...postsFromDB];
    const snapshotMap = new Map(allPosts.map((p) => [String(p.postId), p]));

    const orderedSnapshots = ids
      .map((id) => snapshotMap.get(id))
      .filter((p): p is PostSnapshot => p != null);

    // ------------------------------
    // 4️⃣ Gọi sang POST_SERVICE lấy reaction của user
    // ------------------------------
    let reactions: Record<string, ReactionType> = {};
    if (userId && orderedSnapshots.length) {
      try {
        reactions = await firstValueFrom(
          this.postClient.send<Record<string, ReactionType>>(
            'get_reacted_types_batch',
            {
              userId,
              targetType: TargetType.POST,
              targetIds: orderedSnapshots.map((p) => p.postId),
            },
          ),
        );
      } catch (err) {
        console.warn('⚠️ Failed to fetch reactions, continuing without them');
      }
    }

    // ------------------------------
    // 5️⃣ Map sang DTO kèm reaction
    // ------------------------------
    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(
      orderedSnapshots,
      reactions,
    );

    // ------------------------------
    // 6️⃣ Tính nextCursor
    // ------------------------------
    let nextCursor: string | null = null;
    if (dtoPosts.length === limit) {
      const last = orderedSnapshots[orderedSnapshots.length - 1];
      const meta = await this.redis.hgetall(`post:meta:${last.postId}`);

      const createdAt = meta?.createdAt
        ? parseInt(meta.createdAt, 10)
        : new Date(last.postCreatedAt ?? Date.now()).getTime();

      const score = await this.redis.zscore(effectiveKey, last.postId);
      if (score) {
        nextCursor = `${score}_${createdAt}`;
      }
    }

    return new CursorPageResponse(dtoPosts, nextCursor, !!nextCursor);
  }
}
