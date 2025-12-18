import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConversationResponseDTO } from '@repo/dtos';

const TTL = 60 * 5; // 5 phút

// Dữ liệu conv cache trong Redis (detail)
type CachedConversation = ConversationResponseDTO & {
  participants: string[];
  createdAt: string | Date;
  updatedAt: string | Date;
};

@Injectable()
export class ConversationCacheService {
  private readonly logger = new Logger(ConversationCacheService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ===== KEY HELPERS =====

  private getUserConvKeys(userId: string) {
    return {
      zKey: `user:${userId}:conversations:z`,
      emptyKey: `user:${userId}:conversations:empty`,
    };
  }

  private getConvKeys(convId: string) {
    return {
      detailKey: `conv:${convId}:detail`,
    };
  }

  // ===== DETAIL CACHE =====

  async getConversationDetail(
    convId: string,
  ): Promise<CachedConversation | null> {
    const { detailKey } = this.getConvKeys(convId);
    const cached = await this.redis.get(detailKey);
    if (!cached) return null;
    return JSON.parse(cached) as CachedConversation;
  }

  async setConversationDetail(dto: ConversationResponseDTO): Promise<void> {
    const convId = dto._id.toString();
    const { detailKey } = this.getConvKeys(convId);
    await this.redis.set(detailKey, JSON.stringify(dto), 'EX', TTL);
  }

  async removeConversationDetail(convId: string): Promise<void> {
    const { detailKey } = this.getConvKeys(convId);
    await this.redis.del(detailKey);
  }


  // ===== EMPTY FLAG =====

  async hasEmptyFlag(userId: string): Promise<boolean> {
    const { emptyKey } = this.getUserConvKeys(userId);
    return !!(await this.redis.exists(emptyKey));
  }

  async markEmpty(userId: string, seconds = 60): Promise<void> {
    const { emptyKey } = this.getUserConvKeys(userId);
    await this.redis.set(emptyKey, '1', 'EX', seconds);
  }

  async clearEmpty(userId: string): Promise<void> {
    const { emptyKey } = this.getUserConvKeys(userId);
    await this.redis.del(emptyKey);
  }

  // ===== USER LIST (ZSET) =====

  /**
   * Upsert 1 conversation vào list của user (ZSET).
   * - score = updatedAt (hoặc createdAt)
   * - member = convId
   */
  async upsertConversationToUserList(
    userId: string,
    dto: ConversationResponseDTO,
  ): Promise<void> {
    const { zKey, emptyKey } = this.getUserConvKeys(userId);
    const convId = dto._id.toString();

    const score = new Date(
      (dto as any).updatedAt ?? (dto as any).createdAt,
    ).getTime();

    const pipeline = this.redis.pipeline();
    pipeline.zadd(zKey, score, convId);

    // giữ tối đa 100 conv gần nhất
    pipeline.zremrangebyrank(zKey, 0, -101);

    const ttl = TTL + Math.floor(Math.random() * 300);
    pipeline.expire(zKey, ttl);
    pipeline.del(emptyKey);

    await pipeline.exec();
  }

  async removeConversationFromUser(userId: string, convId: string) {
    const { zKey, emptyKey } = this.getUserConvKeys(userId);
    const pipeline = this.redis.pipeline();
    pipeline.zrem(zKey, convId);
    pipeline.del(emptyKey);
    await pipeline.exec();
  }

  /**
   * Lấy page conversations từ list cache:
   * ZSET -> ids -> MGET detail
   */
  async getUserConversationsPage(
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: CachedConversation[];
    hasNext: boolean;
    nextCursor: string | null;
  } | null> {
    const { zKey } = this.getUserConvKeys(userId);

    let maxScore: string | number = '+inf';
    if (cursor) maxScore = `(${cursor}`;

    const ids = await this.redis.zrevrangebyscore(
      zKey,
      maxScore,
      '-inf',
      'LIMIT',
      0,
      limit + 1,
    );

    if (!ids.length) return null;

    const hasNext = ids.length > limit;
    const selected = ids.slice(0, limit);

    const detailKeys = selected.map((id) => this.getConvKeys(id).detailKey);
    const raw = await this.redis.mget(...detailKeys);

    const items: CachedConversation[] = raw
      .filter((v): v is string => !!v)
      .map((v) => JSON.parse(v));

    if (!items.length) return null;

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasNext && lastItem?.updatedAt
        ? new Date(lastItem.updatedAt).getTime().toString()
        : null;

    return { items, hasNext, nextCursor };
  }

  /**
   * Cache list ZSET cho nhiều users (chỉ upsert list, không store data hash nữa).
   */
  async cacheConversationsForUsers(
    users: string[] | string,
    items: ConversationResponseDTO[],
  ): Promise<void> {
    const userList = Array.isArray(users) ? users : [users];

    // ưu tiên pipeline: mỗi user 1 pipeline để giảm round-trip
    for (const userId of userList) {
      const { zKey, emptyKey } = this.getUserConvKeys(userId);
      const pipeline = this.redis.pipeline();

      for (const item of items) {
        const id = item._id.toString();
        const score = new Date(
          (item as any).updatedAt ?? (item as any).createdAt,
        ).getTime();
        pipeline.zadd(zKey, score, id);
      }

      pipeline.zremrangebyrank(zKey, 0, -101);
      const ttl = TTL + Math.floor(Math.random() * 300);
      pipeline.expire(zKey, ttl);
      pipeline.del(emptyKey);

      await pipeline.exec();
    }
  }

  /**
   * Xóa cache globally khi xóa conv:
   * - remove khỏi ZSET của từng participant
   * - delete detail + participants set
   */
  async removeConversationGlobally(convId: string, participants: string[]) {
    const { detailKey } = this.getConvKeys(convId);
    const pipeline = this.redis.pipeline();

    for (const userId of participants) {
      const { zKey, emptyKey } = this.getUserConvKeys(userId);
      pipeline.zrem(zKey, convId);
      pipeline.del(emptyKey);
    }

    pipeline.del(detailKey);


    await pipeline.exec();
  }
}
