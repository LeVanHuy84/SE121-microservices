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
  async removeMessageDetail(messageId: string): Promise<void> {
    const { detailKey } = this.getMessageKeys(messageId);
    await this.redis.del(detailKey);
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

  // ===== LIST (ZSET) =====

  async upsertMessageToConversationList(
    conversationId: string,
    dto: MessageResponseDTO,
  ): Promise<void> {
    const { zKey, emptyKey } = this.getConvMsgKeys(conversationId);
    const msgId = dto._id.toString();
    const score = new Date(dto.createdAt).getTime();

    const pipeline = this.redis.pipeline();
    pipeline.zadd(zKey, score, msgId);

    // giữ ~200 messages mới nhất
    pipeline.zremrangebyrank(zKey, 0, -201);

    const ttl = TTL + Math.floor(Math.random() * 300);
    pipeline.expire(zKey, ttl);
    pipeline.del(emptyKey);

    await pipeline.exec();
  }

  async removeMessageFromConversation(
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const { zKey } = this.getConvMsgKeys(conversationId);
    await this.redis.zrem(zKey, messageId);
  }

  // ===== PAGE FETCH (ZSET -> ids -> MGET details) =====

  async getMessagesPage(
    conversationId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: CachedMessage[];
    hasNext: boolean;
    nextCursor: string | null;
  } | null> {
    const { zKey } = this.getConvMsgKeys(conversationId);

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

    const detailKeys = selected.map((id) => this.getMessageKeys(id).detailKey);
    const raw = await this.redis.mget(...detailKeys);

    const missingIds: string[] = [];
    const items: CachedMessage[] = [];
    raw.forEach((value, idx) => {
      if (!value) {
        missingIds.push(selected[idx]);
        return;
      }
      items.push(JSON.parse(value));
    });

    if (missingIds.length) {
      const cleanup = this.redis.pipeline();
      missingIds.forEach((id) => cleanup.zrem(zKey, id));
      await cleanup.exec();
    }

    if (!items.length) return null;

    const last = items[items.length - 1];
    const nextCursor =
      hasNext && last?.createdAt
        ? new Date(last.createdAt).getTime().toString()
        : null;

    return { items, hasNext, nextCursor };
  }

  /**
   * Cache một list messages vào:
   * - msg:{id}:detail
   * - conv:{id}:messages:z
   */
  async cacheMessages(
    conversationId: string,
    items: MessageResponseDTO[],
  ): Promise<void> {
    if (!items.length) return;

    // pipeline 1: set details
    const p1 = this.redis.pipeline();
    for (const item of items) {
      const { detailKey } = this.getMessageKeys(item._id.toString());
      p1.set(detailKey, JSON.stringify(item), 'EX', TTL);
    }
    await p1.exec();

    // pipeline 2: upsert zset
    const { zKey, emptyKey } = this.getConvMsgKeys(conversationId);
    const p2 = this.redis.pipeline();

    for (const item of items) {
      const id = item._id.toString();
      const score = new Date(item.createdAt).getTime();
      p2.zadd(zKey, score, id);
    }

    p2.zremrangebyrank(zKey, 0, -201);

    const ttl = TTL + Math.floor(Math.random() * 300);
    p2.expire(zKey, ttl);
    p2.del(emptyKey);

    await p2.exec();
  }

  async clearConversationMessages(conversationId: string): Promise<void> {
    const { zKey, emptyKey } = this.getConvMsgKeys(conversationId);

    // NOTE: detail msg keys không thể biết hết để del sạch,
    // thường chỉ cần clear zset + empty flag là đủ.
    const pipeline = this.redis.pipeline();
    pipeline.del(zKey);
    pipeline.del(emptyKey);
    await pipeline.exec();
  }
}
