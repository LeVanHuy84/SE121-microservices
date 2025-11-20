import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import {
  ConversationResponseDTO,
  CreateConversationDTO,
  CursorPageResponse,
  CursorPaginationDTO,
  UpdateConversationDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, Types } from 'mongoose';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { populateAndMapConversation } from 'src/utils/mapping';

const TTL = 60 * 5;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ==================== GET BY ID ====================
  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDTO> {
    const key = `conv:${conversationId}:detail`;
    const cached = await this.redis.get(key);

    if (cached) {
      const conv = JSON.parse(cached);

      //  Check quyền từ cached
      if (!conv.participants?.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      // Trả về DTO đã cache sẵn
      return plainToInstance(ConversationResponseDTO, conv, {
        excludeExtraneousValues: true,
      });
    }

    // DB fallback
    const convDoc = await this.conversationModel
      .findById(conversationId)
      .populate('lastMessage')
      .exec();

    if (!convDoc) throw new RpcException('Conversation not found');

    //  Check quyền từ DB
    if (!convDoc.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    // Chuẩn hóa bằng utils
    const dto = await populateAndMapConversation(convDoc);

    // Cache lại DTO để lần sau lấy ra dùng luôn
    await this.redis.set(key, JSON.stringify(dto), 'EX', TTL);

    return dto;
  }

  // ==================== GET PARTICIPANTS ====================
  async getParticipantsInConversation(
    conversationId: string,
  ): Promise<string[]> {
    const key = `conv:${conversationId}:participants`;
    const cached = await this.redis.smembers(key);
    if (cached.length) return cached;

    const conversation = await this.conversationModel
      .findById(conversationId)
      .lean();
    if (!conversation) throw new RpcException('Conversation not found');

    const participants = conversation.participants.map((id) => id.toString());
    if (participants.length) {
      await this.redis.sadd(key, ...participants);
      await this.redis.expire(key, TTL);
    }
    return participants;
  }

  // ==================== GET CONVERSATIONS (CURSOR PAGING + REDIS ZSET) ====================
  async getConversations(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<ConversationResponseDTO>> {
    const zKey = `user:${userId}:conversations:z`;
    const dataKey = `user:${userId}:conversations:data`;
    const emptyKey = `user:${userId}:conversations:empty`;

    const limit = query.limit;
    if (await this.redis.exists(emptyKey))
      return new CursorPageResponse([], null, false);

    let maxScore: string | number = '+inf';
    if (query.cursor) maxScore = `(${query.cursor}`;

    const ids = await this.redis.zrevrangebyscore(
      zKey,
      maxScore,
      '-inf',
      'LIMIT',
      0,
      limit + 1,
    );

    if (ids.length > 0) {
      const hasNext = ids.length > limit;
      const selected = ids.slice(0, limit);

      const cached = await this.redis.hmget(dataKey, ...selected);
      const items = cached
        .filter((c): c is string => c !== null)
        .map((c) => JSON.parse(c));

      const lastItem = items[items.length - 1];
      const nextCursor =
        hasNext && lastItem?.updatedAt
          ? new Date(lastItem.updatedAt).getTime().toString()
          : null;

      return new CursorPageResponse(
        plainToInstance(ConversationResponseDTO, items),
        nextCursor,
        hasNext,
      );
    }

    // Cache miss → DB fallback
    const dbFilter = query.cursor
      ? { updatedAt: { $lt: new Date(Number(query.cursor)) } }
      : {};
    const dbItems = await this.conversationModel
      .find({ participants: userId, ...dbFilter })
      .sort({ updatedAt: -1 })
      .populate('lastMessage')
      .limit(limit + 1)
      .lean();

    if (dbItems.length > 0) {

      const mapped = await Promise.all(
        dbItems.map((doc) => populateAndMapConversation(doc)),
      );

      await this.cacheConversations([userId], mapped);

      const hasNext = mapped.length > limit;
      const items = mapped.slice(0, limit);
      const lastItem = items[items.length - 1];
      const nextCursor =
        hasNext && (lastItem as any)?.updatedAt
          ? new Date((lastItem as any).updatedAt).getTime().toString()
          : null;

      return new CursorPageResponse(
        plainToInstance(ConversationResponseDTO, items),
        nextCursor,
        hasNext,
      );
    }

    await this.redis.set(emptyKey, '1', 'EX', 60);
    return new CursorPageResponse([], null, false);
  }

 

  // ==================== CACHE HELPERS ====================
  private async cacheConversations(users: string[] | string, items: any[]) {
    const userList = Array.isArray(users) ? users : [users];

    for (const userId of userList) {
      const zKey = `user:${userId}:conversations:z`;
      const dataKey = `user:${userId}:conversations:data`;
      const emptyKey = `user:${userId}:conversations:empty`;

      const pipeline = this.redis.pipeline();
      for (const item of items) {
        const id = item._id.toString();
        const score = new Date(item.updatedAt ?? item.createdAt).getTime();
        pipeline.zadd(zKey, score, id);
        await this.redis.hset(
          dataKey,
          id,
          JSON.stringify(item.toObject ? item.toObject() : item),
        );
      }
      pipeline.zremrangebyrank(zKey, 0, -101);
      const ttl = TTL + Math.floor(Math.random() * 300);
      pipeline.expire(zKey, ttl);
      pipeline.expire(dataKey, ttl);
      pipeline.del(emptyKey);
      await pipeline.exec();
    }
  }

  async updateConversationCache(doc: any) {
    const users = doc.participants;
    const pipeline = this.redis.pipeline();
    for (const userId of users) {
      const zKey = `user:${userId}:conversations:z`;
      const dataKey = `user:${userId}:conversations:data`;
      const emptyKey = `user:${userId}:conversations:empty`;

      const member = doc._id.toString();
      const score = new Date(doc.updatedAt ?? doc.createdAt).getTime();

      pipeline.del(emptyKey);
      pipeline.zadd(zKey, score, member);
      pipeline.hset(
        dataKey,
        member,
        JSON.stringify(doc.toObject ? doc.toObject() : doc),
      );
      pipeline.zremrangebyrank(zKey, 0, -101);
      const ttl = TTL + Math.floor(Math.random() * 300);
      pipeline.expire(zKey, ttl);
      pipeline.expire(dataKey, ttl);
    }
    await pipeline.exec();
  }


}
