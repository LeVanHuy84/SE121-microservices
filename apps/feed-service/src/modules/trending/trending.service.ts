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
import { SnapshotRepository } from 'src/mongo/repository/snapshot.repository';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TrendingService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly snapshotRepo: SnapshotRepository,
    @Inject('POST_SERVICE') private readonly postClient: ClientProxy, // 👈 thêm dòng này
  ) {}

  private async getEffectiveKey(emotion?: Emotion): Promise<string | null> {
    if (!emotion) return 'post:score';

    const emotionKey = `post:emotion:${emotion.toLowerCase()}`;
    const exists = await this.redis.exists(emotionKey);

    if (!exists) return null;

    const tempKey = `post:score:tmp:${emotion.toLowerCase()}`;

    await this.redis.zinterstore(
      tempKey,
      2,
      'post:score',
      emotionKey,
      'WEIGHTS',
      1,
      0,
    );

    await this.redis.expire(tempKey, 5);
    return tempKey;
  }

  /**
   * 🔥 Lấy danh sách bài trending (cursor pagination chuẩn)
   * Cursor = `${rankingScore}_${createdAt}`
   */
  async getTrendingPosts(query: TrendingQuery, userId?: string) {
    const { cursor, limit = 10, mainEmotion } = query;

    // ✅ LẤY KEY ĐÚNG Ở ĐÂY
    const effectiveKey = await this.getEffectiveKey(mainEmotion);

    // 👉 emotion không có dữ liệu → trả rỗng
    if (!effectiveKey) {
      return new CursorPageResponse([], null, false);
    }

    // ------------------------------
    // 1️⃣ Parse cursor
    // ------------------------------
    let maxScore = '+inf';
    let minScore = '-inf';

    if (cursor) {
      const [scoreStr] = cursor.split('_');
      const score = parseFloat(scoreStr);
      maxScore = `(${score}`;
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

    console.log('Ids: ', ids);

    // ------------------------------
    // 3️⃣ Lấy snapshot trực tiếp từ DB (bỏ cache)
    // ------------------------------
    const postsFromDB = ids.length
      ? await this.snapshotRepo.findPostsByIds(ids)
      : [];

    const snapshotMap = new Map(postsFromDB.map((p) => [String(p.postId), p]));

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
