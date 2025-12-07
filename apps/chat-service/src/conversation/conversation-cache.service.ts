import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConversationResponseDTO } from '@repo/dtos';

const TTL = 60 * 5; // 5 phút

// Dữ liệu conv cache trong Redis
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
      dataKey: `user:${userId}:conversations:data`,
      emptyKey: `user:${userId}:conversations:empty`,
    };
  }

  private getConvKeys(convId: string) {
    return {
      detailKey: `conv:${convId}:detail`,
      participantsKey: `conv:${convId}:participants`,
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
    const { detailKey } = this.getConvKeys(dto._id.toString());
    await this.redis.set(detailKey, JSON.stringify(dto), 'EX', TTL);
  }

  // ===== PARTICIPANTS CACHE =====

  async getParticipants(conversationId: string): Promise<string[] | null> {
    const { participantsKey } = this.getConvKeys(conversationId);
    const members = await this.redis.smembers(participantsKey);
    if (!members.length) return null;
    return members;
  }

  async setParticipants(
    conversationId: string,
    participants: string[],
  ): Promise<void> {
    const { participantsKey } = this.getConvKeys(conversationId);
    if (!participants.length) {
      await this.redis.del(participantsKey);
      return;
    }

    const pipeline = this.redis.pipeline();
    pipeline.del(participantsKey);
    pipeline.sadd(participantsKey, ...participants);
    pipeline.expire(participantsKey, TTL);
    await pipeline.exec();
  }

  // ===== EMPTY FLAG (user không có conv) =====

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

  // ===== USER CONVERSATIONS PAGE (ZSET + HASH) =====

  async getUserConversationsPage(
    userId: string,
    cursor: string | null,
    limit: number,
  ): Promise<{
    items: CachedConversation[];
    hasNext: boolean;
    nextCursor: string | null;
  } | null> {
    const { zKey, dataKey } = this.getUserConvKeys(userId);

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
    const items: CachedConversation[] = raw
      .filter((c): c is string => !!c)
      .map((c) => JSON.parse(c));

    if (!items.length) return null;

    const lastItem = items[items.length - 1];
    const nextCursor =
      hasNext && lastItem?.updatedAt
        ? new Date(lastItem.updatedAt).getTime().toString()
        : null;

    return { items, hasNext, nextCursor };
  }

  // ===== CACHE CONVERSATIONS VÀO LIST USER =====

  async cacheConversationsForUsers(
    users: string[] | string,
    items: ConversationResponseDTO[],
  ): Promise<void> {
    const userList = Array.isArray(users) ? users : [users];

    for (const userId of userList) {
      const { zKey, dataKey, emptyKey } = this.getUserConvKeys(userId);
      const pipeline = this.redis.pipeline();

      for (const item of items) {
        const id = item._id.toString();
        const score = new Date(
          (item as any).updatedAt ?? (item as any).createdAt,
        ).getTime();

        pipeline.zadd(zKey, score, id);
        pipeline.hset(dataKey, id, JSON.stringify(item));
      }

      pipeline.zremrangebyrank(zKey, 0, -101);
      const ttl = TTL + Math.floor(Math.random() * 300);
      pipeline.expire(zKey, ttl);
      pipeline.expire(dataKey, ttl);
      pipeline.del(emptyKey);

      await pipeline.exec();
    }
  }

  // ===== REMOVE 1 CONV KHỎI CACHE CỦA 1 USER (hide / delete local) =====

  async removeConversationFromUser(
    userId: string,
    convId: string,
  ): Promise<void> {
    const { zKey, dataKey, emptyKey } = this.getUserConvKeys(userId);
    const pipeline = this.redis.pipeline();
    pipeline.zrem(zKey, convId);
    pipeline.hdel(dataKey, convId);
    pipeline.del(emptyKey);
    await pipeline.exec();
  }

  // ===== XÓA CACHE GLOBALLY KHI XÓA CONV =====

  async removeConversationGlobally(
    convId: string,
    participants: string[],
  ): Promise<void> {
    const { detailKey, participantsKey } = this.getConvKeys(convId);
    const pipeline = this.redis.pipeline();

    for (const userId of participants) {
      const { zKey, dataKey, emptyKey } = this.getUserConvKeys(userId);
      pipeline.zrem(zKey, convId);
      pipeline.hdel(dataKey, convId);
      pipeline.del(emptyKey);
    }

    pipeline.del(detailKey);
    pipeline.del(participantsKey);

    await pipeline.exec();
  }
}
