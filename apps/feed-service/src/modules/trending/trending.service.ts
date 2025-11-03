import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { CursorPageResponse, TrendingQuery, Emotion } from '@repo/dtos';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { SnapshotMapper } from 'src/common/snapshot.mapper';
import { CacheLayerService } from '../cache-layer/cache-layer.service';
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';

@Injectable()
export class TrendingService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotCache: CacheLayerService,
    private readonly snapshotRepo: SnapshotRepository,
  ) {}

  private getKey(mainEmotion?: Emotion): string {
    return mainEmotion
      ? `post:score:emotion:${mainEmotion.toLowerCase()}`
      : 'post:score';
  }

  /**
   * 🔥 Lấy danh sách bài trending (cursor pagination)
   */
  async getTrendingPosts(query: TrendingQuery) {
    const { cursor, limit = 10, mainEmotion } = query;
    const key = this.getKey(mainEmotion);

    // Nếu key emotion chưa tồn tại => fallback về key tổng
    const exists = await this.redis.exists(key);
    const effectiveKey = exists ? key : 'post:score';

    // 🔹 Cursor-based pagination
    let startIndex = 0;
    if (cursor) {
      const rank = await this.redis.zrevrank(effectiveKey, cursor);
      startIndex = rank !== null ? rank + 1 : 0;
    }

    // 🔹 Lấy danh sách postId (không cần score)
    const ids = await this.redis.zrevrange(
      effectiveKey,
      startIndex,
      startIndex + limit - 1,
    );

    if (!ids.length) {
      return new CursorPageResponse([], null, false);
    }

    const postCache = await this.snapshotCache.getPostBatch(ids);
    const missingIds = ids.filter((id) => !postCache.has(id));

    const postsFromDB = await this.snapshotRepo.findPostsByIds(missingIds);
    await this.snapshotCache.setPostBatch(postsFromDB);

    const allPosts = [...postCache.values(), ...postsFromDB];

    const snapshotMap = new Map<string, PostSnapshot>(
      allPosts.map((p) => [String(p.postId), p]),
    );

    const orderedSnapshots = ids
      .map((id) => snapshotMap.get(id))
      .filter((p): p is PostSnapshot => p != null);

    const dtoPosts = SnapshotMapper.toPostSnapshotDTOs(orderedSnapshots);

    // 🔹 Cursor info
    const nextCursor =
      dtoPosts.length === limit ? dtoPosts[dtoPosts.length - 1].postId : null;

    return new CursorPageResponse(dtoPosts, nextCursor, !!nextCursor);
  }
}
