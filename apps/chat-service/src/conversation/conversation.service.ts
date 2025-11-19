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

const TTL = 60 * 5;

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // // ==================== CREATE ====================
  // async createConversation(
  //   dto: CreateConversationDTO,
  // ): Promise<ConversationResponseDTO> {
  //   if (!dto.isGroup && dto.participants.length !== 2) {
  //     throw new RpcException('Conversations must have exactly 2 participants.');
  //   }
  //   if (dto.isGroup && dto.participants.length < 3) {
  //     throw new RpcException(
  //       'Group conversations must have at least 3 participants.',
  //     );
  //   }

  //   if (!dto.isGroup) {
  //     const existing = await this.conversationModel.findOne({
  //       isGroup: false,
  //       participants: {
  //         $all: dto.participants,
  //         $size: dto.participants.length,
  //       },
  //     });
  //     if (existing) {
  //       throw new RpcException('One-on-one conversation already exists.');
  //     }
  //   }

  //   const existingGroup = await this.conversationModel.findOne({
  //     isGroup: dto.isGroup,
  //     groupName: dto.groupName,
  //     participants: {
  //       $all: dto.participants,
  //       $size: dto.participants.length,
  //     },
  //   });
  //   if (existingGroup) {
  //     throw new RpcException('A group with this name already exists.');
  //   }

  //   const conversation = await this.conversationModel.create({
  //     isGroup: dto.isGroup,
  //     participants: dto.participants,
  //     groupName: dto.isGroup ? dto.groupName : undefined,
  //   });

  //   await this.updateConversationCache(conversation.toObject());

  //   return plainToInstance(ConversationResponseDTO, conversation.toObject(), {
  //     excludeExtraneousValues: true,
  //   });
  // }

  // // ==================== GET BY ID ====================
  // async getConversationById(
  //   userId: string,
  //   conversationId: string,
  // ): Promise<ConversationResponseDTO> {
  //   const key = `conv:${conversationId}:detail`;
  //   const cached = await this.redis.get(key);

  //   if (cached) {
  //     const conv = JSON.parse(cached);

  //     // ❗ Check quyền từ cached
  //     if (!conv.participants?.includes(userId)) {
  //       throw new RpcException('You are not in this conversation');
  //     }

  //     return plainToInstance(ConversationResponseDTO, conv, {
  //       excludeExtraneousValues: true,
  //     });
  //   }

  //   // DB fallback
  //   const conversation = await this.conversationModel
  //     .findById(conversationId)
  //     .populate('lastMessage')
  //     .lean();

  //   if (!conversation) throw new RpcException('Conversation not found');

  //   // ❗ Check quyền từ DB
  //   if (!conversation.participants.includes(userId)) {
  //     throw new RpcException('You are not in this conversation');
  //   }

  //   // Cache lại
  //   await this.redis.set(key, JSON.stringify(conversation), 'EX', TTL);

  //   return plainToInstance(
  //     ConversationResponseDTO,
  //     {
  //       ...conversation,
  //       _id: conversation._id.toString(),
  //       lastMessage: conversation.lastMessage
  //         ? {
  //             ...conversation.lastMessage,
  //             _id: (conversation.lastMessage as any)._id.toString(),
  //           }
  //         : null,
  //     },
  //     {
  //       excludeExtraneousValues: true,
  //     },
  //   );
  // }

  // // ==================== GET PARTICIPANTS ====================
  // async getParticipantsInConversation(
  //   conversationId: string,
  // ): Promise<string[]> {
  //   const key = `conv:${conversationId}:participants`;
  //   const cached = await this.redis.smembers(key);
  //   if (cached.length) return cached;

  //   const conversation = await this.conversationModel
  //     .findById(conversationId)
  //     .lean();
  //   if (!conversation) throw new RpcException('Conversation not found');

  //   const participants = conversation.participants.map((id) => id.toString());
  //   if (participants.length) {
  //     await this.redis.sadd(key, ...participants);
  //     await this.redis.expire(key, TTL);
  //   }
  //   return participants;
  // }

  // // ==================== GET CONVERSATIONS (CURSOR PAGING + REDIS ZSET) ====================
  // async getConversations(
  //   userId: string,
  //   query: CursorPaginationDTO,
  // ): Promise<CursorPageResponse<ConversationResponseDTO>> {
  //   const zKey = `user:${userId}:conversations:z`;
  //   const dataKey = `user:${userId}:conversations:data`;
  //   const emptyKey = `user:${userId}:conversations:empty`;

  //   const limit = query.limit;
  //   if (await this.redis.exists(emptyKey))
  //     return new CursorPageResponse([], null, false);

  //   let maxScore: string | number = '+inf';
  //   if (query.cursor) maxScore = `(${query.cursor}`;

  //   const ids = await this.redis.zrevrangebyscore(
  //     zKey,
  //     maxScore,
  //     '-inf',
  //     'LIMIT',
  //     0,
  //     limit + 1,
  //   );

  //   if (ids.length > 0) {
  //     const hasNext = ids.length > limit;
  //     const selected = ids.slice(0, limit);

  //     const cached = await this.redis.hmget(dataKey, ...selected);
  //     const items = cached
  //       .filter((c): c is string => c !== null)
  //       .map((c) => JSON.parse(c));

  //     const lastItem = items[items.length - 1];
  //     const nextCursor =
  //       hasNext && lastItem?.updatedAt
  //         ? new Date(lastItem.updatedAt).getTime().toString()
  //         : null;

  //     return new CursorPageResponse(
  //       plainToInstance(ConversationResponseDTO, items),
  //       nextCursor,
  //       hasNext,
  //     );
  //   }

  //   // Cache miss → DB fallback
  //   const dbFilter = query.cursor
  //     ? { updatedAt: { $lt: new Date(Number(query.cursor)) } }
  //     : {};
  //   const dbItems = await this.conversationModel
  //     .find({ participants: userId, ...dbFilter })
  //     .sort({ updatedAt: -1 })
  //     .populate('lastMessage')
  //     .limit(limit + 1)
  //     .lean();

  //   if (dbItems.length > 0) {
  //     await this.cacheConversations(
  //       [userId],
  //       dbItems.map((item) => item),
  //     );

  //     const hasNext = dbItems.length > limit;
  //     const items = dbItems.slice(0, limit).map((item) => ({
  //       ...item,
  //       _id: item._id.toString(),
  //       lastMessage: item.lastMessage
  //         ? { ...item.lastMessage, _id: item.lastMessage._id.toString() }
  //         : null,
  //     }));
  //     const lastItem = items[items.length - 1];
  //     const nextCursor =
  //       hasNext && (lastItem as any)?.updatedAt
  //         ? new Date((lastItem as any).updatedAt).getTime().toString()
  //         : null;

  //     return new CursorPageResponse(
  //       plainToInstance(ConversationResponseDTO, items),
  //       nextCursor,
  //       hasNext,
  //     );
  //   }

  //   await this.redis.set(emptyKey, '1', 'EX', 60);
  //   return new CursorPageResponse([], null, false);
  // }

  // // ==================== UPDATE ====================
  // async updateConversation(
  //   conversationId: string,
  //   updateData: UpdateConversationDTO,
  // ) {
  //   const conversation = await this.conversationModel.findByIdAndUpdate(
  //     conversationId,
  //     updateData,
  //     { new: true },
  //   );
  //   if (!conversation) throw new RpcException('Conversation not found');

  //   await this.updateConversationCache(conversation.toObject());
  //   return plainToInstance(ConversationResponseDTO, conversation.toObject(), {
  //     excludeExtraneousValues: true,
  //   });
  // }

  // // ==================== DELETE ====================
  // async deleteConversation(conversationId: string) {
  //   const conversation =
  //     await this.conversationModel.findByIdAndDelete(conversationId);
  //   if (!conversation) return;

  //   const participants = conversation.participants || [];
  //   for (const userId of participants) {
  //     const zKey = `user:${userId}:conversations:z`;
  //     const dataKey = `user:${userId}:conversations:data`;
  //     const emptyKey = `user:${userId}:conversations:empty`;
  //     const pipeline = this.redis.pipeline();
  //     pipeline.zrem(zKey, conversationId);
  //     pipeline.hdel(dataKey, conversationId);
  //     pipeline.del(emptyKey);
  //     await pipeline.exec();
  //   }
  // }

  // // ==================== CACHE HELPERS ====================
  // private async cacheConversations(users: string[] | string, items: any[]) {
  //   const userList = Array.isArray(users) ? users : [users];

  //   for (const userId of userList) {
  //     const zKey = `user:${userId}:conversations:z`;
  //     const dataKey = `user:${userId}:conversations:data`;
  //     const emptyKey = `user:${userId}:conversations:empty`;

  //     const pipeline = this.redis.pipeline();
  //     for (const item of items) {
  //       const id = item._id.toString();
  //       const score = new Date(item.updatedAt ?? item.createdAt).getTime();
  //       pipeline.zadd(zKey, score, id);
  //       await this.redis.hset(
  //         dataKey,
  //         id,
  //         JSON.stringify(item.toObject ? item.toObject() : item),
  //       );
  //     }
  //     pipeline.zremrangebyrank(zKey, 0, -101);
  //     const ttl = TTL + Math.floor(Math.random() * 300);
  //     pipeline.expire(zKey, ttl);
  //     pipeline.expire(dataKey, ttl);
  //     pipeline.del(emptyKey);
  //     await pipeline.exec();
  //   }
  // }

  // private async updateConversationCache(doc: any) {
  //   const users = doc.participants;
  //   const pipeline = this.redis.pipeline();
  //   for (const userId of users) {
  //     const zKey = `user:${userId}:conversations:z`;
  //     const dataKey = `user:${userId}:conversations:data`;
  //     const emptyKey = `user:${userId}:conversations:empty`;

  //     const member = doc._id.toString();
  //     const score = new Date(doc.updatedAt ?? doc.createdAt).getTime();

  //     pipeline.del(emptyKey);
  //     pipeline.zadd(zKey, score, member);
  //     pipeline.hset(
  //       dataKey,
  //       member,
  //       JSON.stringify(doc.toObject ? doc.toObject() : doc),
  //     );
  //     pipeline.zremrangebyrank(zKey, 0, -101);
  //     const ttl = TTL + Math.floor(Math.random() * 300);
  //     pipeline.expire(zKey, ttl);
  //     pipeline.expire(dataKey, ttl);
  //   }
  //   await pipeline.exec();
  // }

  // async updateLastMessage(conversationId: string, messageId: string) {
  //   const conversation = await this.conversationModel
  //     .findByIdAndUpdate(
  //       conversationId,
  //       {
  //         lastMessage: messageId,
  //         updatedAt: new Date(),
  //       },
  //       { new: true },
  //     )
  //     .populate('lastMessage')
  //     .lean();

  //   this.logger.log(`Updated lastMessage for conversation ${conversation}`);

  //   if (!conversation) throw new RpcException('Conversation not found');

  //   await this.updateConversationCache(conversation);

  //   return plainToInstance(ConversationResponseDTO, {
  //     ...conversation,
  //     _id: conversation._id.toString(),
  //     lastMessage: conversation.lastMessage
  //       ? { ...conversation.lastMessage, _id: conversation.lastMessage._id.toString() }
  //       : null,
  //   }, {
  //     excludeExtraneousValues: true,
  //   });
  // }

  // // ==================== MARK SEEN LAST MESSAGE ====================
  // async markSeenLastMessage(
  //   conversationId: string,
  //   userId: string,
  // ): Promise<ConversationResponseDTO> {
  //   // Lấy conversation và lastMessage
  //   const conversation = await this.conversationModel
  //     .findById(conversationId)
  //     .populate('lastMessage')
  //     .lean();

  //   if (!conversation) throw new RpcException('Conversation not found');

  //   const lastMsg = conversation.lastMessage as any;
  //   if (!lastMsg) {
  //     // Nếu chưa có tin nhắn nào thì trả về luôn
  //     return plainToInstance(ConversationResponseDTO, {
  //       ...conversation,
  //       _id: conversation._id.toString(),
  //       lastMessage: null,
  //     }, {
  //       excludeExtraneousValues: true,
  //     });
  //   }

  //   // Cập nhật seen cho lastMessage nếu chưa có
  //   if (!lastMsg.seenBy.includes(userId)) {
  //     lastMsg.seenBy.push(userId);
  //     lastMsg.status = 'seen';
  //     await lastMsg.save();

  //     // Update cache Redis cho message
  //     const msgKey = `msg:${lastMsg._id}`;
  //     await this.redis.set(
  //       msgKey,
  //       JSON.stringify(lastMsg),
  //       'EX',
  //       60 * 60 * 6,
  //     );
  //   }

  //   // Cập nhật cache conversation để phản ánh trạng thái mới
  //   await this.updateConversationCache(conversation);

  //   return plainToInstance(ConversationResponseDTO, {
  //     ...conversation,
  //     _id: conversation._id.toString(),
  //     lastMessage: { ...lastMsg, _id: lastMsg._id.toString() },
  //   }, {
  //     excludeExtraneousValues: true,
  //   });
  // }

  // async markDeliveredLastMessage(
  //   conversationId: string,
  //   userId: string,
  // ): Promise<ConversationResponseDTO> {
  //   // Lấy conversation và lastMessage
  //   const conversation = await this.conversationModel
  //     .findById(conversationId)
  //     .populate('lastMessage')
  //     .lean();
  //   if (!conversation) throw new RpcException('Conversation not found');

  //   const lastMsg = conversation.lastMessage as any;
  //   if (!lastMsg) {
  //     // Nếu chưa có tin nhắn nào thì trả về luôn
  //     return plainToInstance(ConversationResponseDTO, {
  //       ...conversation,
  //       _id: conversation._id.toString(),
  //       lastMessage: null,
  //     }, {
  //       excludeExtraneousValues: true,
  //     });
  //   }
  //   // Cập nhật delivered cho lastMessage nếu chưa có
  //   if (!lastMsg.deliveredBy.includes(userId)) {
  //     lastMsg.deliveredBy.push(userId);
  //     await lastMsg.save();
  //     // Update cache Redis cho message
  //     const msgKey = `msg:${lastMsg._id}`;
  //     await this.redis.set(
  //       msgKey,
  //       JSON.stringify(lastMsg),
  //       'EX',
  //       60 * 60 * 6,
  //     );
  //   }
  //   // Cập nhật cache conversation để phản ánh trạng thái mới
  //   await this.updateConversationCache(conversation);
  //   return plainToInstance(ConversationResponseDTO, {
  //     ...conversation,
  //     _id: conversation._id.toString(),
  //     lastMessage: { ...lastMsg, _id: lastMsg._id.toString() },
  //   }, {
  //     excludeExtraneousValues: true,
  //   });
  // }
}
