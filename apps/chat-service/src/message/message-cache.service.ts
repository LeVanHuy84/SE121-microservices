import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import Redis from 'ioredis';
import { MessageResponseDTO } from '@repo/dtos';
import { Model } from 'mongoose';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import { populateAndMapMessage } from 'src/utils/mapping';

const TTL = 60 * 10; // 10 min
const DETAIL_TTL = TTL + 600; // keep detail cache alive longer than list ZSET

type CachedMessage = MessageResponseDTO & {
  createdAt: string | Date;
};

@Injectable()
export class MessageCacheService {
  private readonly logger = new Logger(MessageCacheService.name);
  private readonly setIfNewerScript = `
    local key = KEYS[1]
    local newVersion = tonumber(ARGV[1])
    local payload = ARGV[2]
    local ttl = tonumber(ARGV[3])
    local current = redis.call('GET', key)
    if not current then
      redis.call('SET', key, payload, 'EX', ttl)
      return 1
    end
    local ok, obj = pcall(cjson.decode, current)
    if not ok then
      redis.call('SET', key, payload, 'EX', ttl)
      return 1
    end
    local curVersion = tonumber(obj.syncVersion or 0)
    if curVersion <= newVersion then
      redis.call('SET', key, payload, 'EX', ttl)
      return 1
    end
    return 0
  `;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
  ) {}

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
    const payload = JSON.stringify(dto);
    const createdAt = (dto as any).createdAt;
    const inferredVersion = createdAt ? new Date(createdAt).getTime() : 0;
    const syncVersion = Number((dto as any).syncVersion ?? inferredVersion ?? 0);
    await this.redis.eval(
      this.setIfNewerScript,
      1,
      detailKey,
      String(syncVersion),
      payload,
      String(DETAIL_TTL),
    );
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
    pipeline.zadd(zKey, 'GT', score, msgId);

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
    partial?: boolean;
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
    const itemsById = new Map<string, CachedMessage>();
    raw.forEach((value, idx) => {
      if (!value) {
        missingIds.push(selected[idx]);
        return;
      }
      itemsById.set(selected[idx], JSON.parse(value));
    });

    if (missingIds.length) {
      const docs = await this.messageModel
        .find({ _id: { $in: missingIds }, conversationId })
        .exec();

      if (docs.length) {
        const mapped = docs
          .map((doc) => populateAndMapMessage(doc)!)
          .filter(Boolean) as CachedMessage[];
        await Promise.all(mapped.map((dto) => this.setMessageDetail(dto)));
        mapped.forEach((dto) => itemsById.set(dto._id.toString(), dto));
      }

      const foundIds = new Set(Array.from(itemsById.keys()));
      const notFound = missingIds.filter((id) => !foundIds.has(id));
      if (notFound.length) {
        await this.redis.zrem(zKey, ...notFound);
      }
    }

    const items = selected
      .map((id) => itemsById.get(id))
      .filter(Boolean) as CachedMessage[];

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
      p1.set(detailKey, JSON.stringify(item), 'EX', DETAIL_TTL);
    }
    await p1.exec();

    // pipeline 2: upsert zset
    const { zKey, emptyKey } = this.getConvMsgKeys(conversationId);
    const p2 = this.redis.pipeline();

    for (const item of items) {
      const id = item._id.toString();
      const score = new Date(item.createdAt).getTime();
      p2.zadd(zKey, 'GT', score, id);
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
