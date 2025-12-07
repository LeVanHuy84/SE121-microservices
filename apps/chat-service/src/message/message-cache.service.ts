import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { MessageResponseDTO } from '@repo/dtos';

const TTL = 60 * 5; // 5 phút

type CachedMessage = MessageResponseDTO & {
  createdAt: string | Date;
};

@Injectable()
export class MessageCacheService {
  private readonly logger = new Logger(MessageCacheService.name);

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ===== KEY HELPERS =====

  private getMessageKeys(messageId: string) {
    return {
      detailKey: `msg:${messageId}:detail`,
    };
  }

  private getConvMsgKeys(conversationId: string) {
    return {
      zKey: `conv:${conversationId}:messages:z`,
      dataKey: `conv:${conversationId}:messages:data`,
      emptyKey: `conv:${conversationId}:messages:empty`,
    };
  }

  // ===== DETAIL CACHE =====

  async getMessageDetail(messageId: string): Promise<CachedMessage | null> {
    const { detailKey } = this.getMessageKeys(messageId);
    const cached = await this.redis.get(detailKey);
    if (!cached) return null;
    return JSON.parse(cached) as CachedMessage;
  }

  async setMessageDetail(dto: MessageResponseDTO): Promise<void> {
    const { detailKey } = this.getMessageKeys(dto._id);
    await this.redis.set(detailKey, JSON.stringify(dto), 'EX', TTL);
  }

  // ===== MESSAGE LIST CACHE (per conversation) =====

  async hasEmptyFlag(conversationId: string): Promise<boolean> {
    const { emptyKey } = this.getConvMsgKeys(conversationId);
    return !!(await this.redis.exists(emptyKey));
  }

  async markEmpty(conversationId: string, seconds = 60): Promise<void> {
    const { emptyKey } = this.getConvMsgKeys(conversationId);
    await this.redis.set(emptyKey, '1', 'EX', seconds);
  }

  async clearEmpty(conversationId: string): Promise<void> {
    const { emptyKey } = this.getConvMsgKeys(conversationId);
    await this.redis.del(emptyKey);
  }

  /**
   * Lấy 1 page messages từ cache theo cursor (createdAt)
   * - sort: mới → cũ (desc)
   * - cursor: timestamp (ms) của message cuối cùng page trước
   */
  async getMessagesPage(
    conversationId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: CachedMessage[];
    hasNext: boolean;
    nextCursor: string | null;
  } | null> {
    const { zKey, dataKey } = this.getConvMsgKeys(conversationId);

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

    const raw = await this.redis.hmget(dataKey, ...selected);
    const items: CachedMessage[] = raw
      .filter((c): c is string => !!c)
      .map((c) => JSON.parse(c));

    if (!items.length) return null;

    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last?.createdAt
        ? new Date(last.createdAt).getTime().toString()
        : null;

    return { items, hasNext, nextCursor };
  }

  /**
   * Cache 1 list messages vào ZSET + HASH của conversation
   * - giả định tất cả messages cùng conversationId
   */
  async cacheMessages(
    conversationId: string,
    items: MessageResponseDTO[],
  ): Promise<void> {
    if (!items.length) return;

    const { zKey, dataKey, emptyKey } = this.getConvMsgKeys(conversationId);
    const pipeline = this.redis.pipeline();

    for (const item of items) {
      const id = item._id.toString();
      const score = new Date(item.createdAt).getTime();

      pipeline.zadd(zKey, score, id);
      pipeline.hset(dataKey, id, JSON.stringify(item));
    }

    // giữ lại khoảng 200 messages mới nhất (tuỳ bà chỉnh)
    pipeline.zremrangebyrank(zKey, 0, -201);

    const ttl = TTL + Math.floor(Math.random() * 300);
    pipeline.expire(zKey, ttl);
    pipeline.expire(dataKey, ttl);
    pipeline.del(emptyKey);

    await pipeline.exec();
  }

  /**
   * Xoá 1 message khỏi cache list conversation
   * (không đụng tới detail cache)
   */
  async removeMessageFromConversation(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const { zKey, dataKey } = this.getConvMsgKeys(conversationId);
    const pipeline = this.redis.pipeline();
    pipeline.zrem(zKey, messageId);
    pipeline.hdel(dataKey, messageId);
    await pipeline.exec();
  }

  /**
   * Xoá toàn bộ cache messages của 1 conversation (nếu cần)
   */
  async clearConversationMessages(conversationId: string): Promise<void> {
    const { zKey, dataKey, emptyKey } = this.getConvMsgKeys(conversationId);
    const pipeline = this.redis.pipeline();
    pipeline.del(zKey);
    pipeline.del(dataKey);
    pipeline.del(emptyKey);
    await pipeline.exec();
  }
}
