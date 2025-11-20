import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { plainToInstance } from 'class-transformer';
import {
  CursorPaginationDTO,
  CursorPageResponse,
  MessageResponseDTO,
  SendMessageDTO,
} from '@repo/dtos';
import { Message } from 'src/mongo/schema/message.schema';
import Redis from 'ioredis';
import { populateAndMapMessage } from 'src/utils/mapping';

@Injectable()
export class MessageService {
  private readonly TTL = 60 * 60 * 6; // 6h cache

  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ==================== Helper: Update cache ====================
  async updateMessageCache(msg: any) {
    const msgKey = `msg:${msg._id}`;
    const zKey = `conv:${msg.conversationId}:messages`;
    const score = new Date(msg.createdAt).getTime();
    const pipeline = this.redis.pipeline();
    pipeline.set(
      msgKey,
      JSON.stringify(msg),
      'EX',
      this.TTL + Math.floor(Math.random() * 300),
    );
    pipeline.zadd(zKey, score, msg._id.toString());
    pipeline.zremrangebyrank(zKey, 0, -201);
    pipeline.expire(zKey, this.TTL + Math.floor(Math.random() * 300));
    await pipeline.exec();
  }

  // ==================== Helper: Batch populate replyTo ====================
  private async populateReplies(messages: any[]) {
    const replyIds = messages
      .filter((m) => m.replyTo)
      .map((m) => m.replyTo.toString());
    if (!replyIds.length) return messages;

    const replyRawList = await this.redis.mget(
      replyIds.map((id) => `msg:${id}`),
    );
    const replyMap: Record<string, any> = {};
    replyRawList.forEach((r, idx) => {
      if (r) replyMap[replyIds[idx]] = JSON.parse(r);
    });

    // Fallback DB for missing
    const missingIds = replyIds.filter((id) => !replyMap[id]);
    if (missingIds.length) {
      const replies = await this.messageModel
        .find({ _id: { $in: missingIds } })
        .lean();
      replies.forEach((r) => (replyMap[r._id.toString()] = r));
      // Update cache for missing
      const pipeline = this.redis.pipeline();
      replies.forEach((r) =>
        pipeline.set(`msg:${r._id}`, JSON.stringify(r), 'EX', this.TTL),
      );
      await pipeline.exec();
    }

    messages.forEach((msg) => {
      if (msg.replyTo && replyMap[msg.replyTo])
        msg.replyTo = replyMap[msg.replyTo];
    });
    return messages;
  }

  // ==================== GET MESSAGES (Cursor + Redis) ====================
  async getMessages(
    conversationId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<MessageResponseDTO>> {
    const { cursor, limit } = query;
    const zKey = `conv:${conversationId}:messages`;

    let ids: string[] = [];
    const hasZSet = await this.redis.exists(zKey);

    if (hasZSet) {
      // Cursor paging via zrevrangebyscore
      if (cursor) {
        const score = await this.redis.zscore(zKey, cursor);
        if (score !== null) {
          ids = await this.redis.zrevrangebyscore(
            zKey,
            Number(score) - 1,
            '-inf',
            'LIMIT',
            0,
            limit + 1,
          );
        }
      } else {
        ids = await this.redis.zrevrange(zKey, 0, limit);
      }

      if (ids.length > 0) {
        const raw = await this.redis.mget(ids.map((id) => `msg:${id}`));
        let messages = raw.filter(Boolean).map((r) => JSON.parse(r!));

        messages = await this.populateReplies(messages);

        const hasNext = messages.length > limit;
        const results = hasNext ? messages.slice(0, limit) : messages;
        const nextCursor = hasNext
          ? results[results.length - 1]._id.toString()
          : null;

        const dtoList = await Promise.all(
          results.map((m) => populateAndMapMessage(m)),
        );
        return new CursorPageResponse(
          plainToInstance(MessageResponseDTO, dtoList, {
            excludeExtraneousValues: true,
          }),
          nextCursor,
          hasNext,
        );
      }
    }

    // DB fallback
    const dbFilter: any = { conversationId };
    if (cursor) dbFilter._id = { $lt: new Types.ObjectId(cursor) };

    let dbMessages = await this.messageModel
      .find(dbFilter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean()
      .exec();

    if (dbMessages.length) {
      // Update cache
      const pipeline = this.redis.pipeline();
      dbMessages.forEach((msg) => {
        pipeline.set(`msg:${msg._id}`, JSON.stringify(msg), 'EX', this.TTL);
        pipeline.zadd(
          zKey,
          new Date((msg as any).createdAt).getTime(),
          msg._id.toString(),
        );
      });
      pipeline.zremrangebyrank(zKey, 0, -201);
      pipeline.expire(zKey, this.TTL);
      await pipeline.exec();

      dbMessages = await this.populateReplies(dbMessages);
    }

    const hasNext = dbMessages.length > limit;
    const results = hasNext ? dbMessages.slice(0, limit) : dbMessages;
    const nextCursor = hasNext
      ? results[results.length - 1]._id.toString()
      : null;

    const dtoList = await Promise.all(
      results.map((m) => populateAndMapMessage(m)),
    );

    return new CursorPageResponse(
      plainToInstance(MessageResponseDTO, dtoList, {
        excludeExtraneousValues: true,
      }),
      nextCursor,
      hasNext,
    );
  }


  // ==================== REACT MESSAGE ====================
  async reactMessage(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');

    const existing = msg.reactions.find((r) => r.userId === userId);
    if (existing) existing.emoji = emoji;
    else msg.reactions.push({ userId, emoji });

    await msg.save();
    await this.updateMessageCache(msg.toObject());

    return plainToInstance(MessageResponseDTO, msg.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  // ==================== DELETE MESSAGE ====================
  async deleteMessage(messageId: string) {
    const msg = await this.messageModel.findByIdAndDelete(messageId);
    if (!msg) throw new NotFoundException('Message not found');

    const msgKey = `msg:${messageId}`;
    const zKey = `conv:${msg.conversationId}:messages`;
    const pipeline = this.redis.pipeline();
    pipeline.del(msgKey);
    pipeline.zrem(zKey, messageId);
    await pipeline.exec();
  }

  // ==================== SOFT DELETE ====================
  async softDeleteMessage(
    messageId: string,
    userId: string,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId)
      throw new NotFoundException('Not allowed to delete this message');

    if (!msg.isDeleted) {
      msg.isDeleted = true;
      msg.deletedAt = new Date();
      await msg.save();
      await this.updateMessageCache(msg.toObject());
    }

    return plainToInstance(MessageResponseDTO, msg.toObject(), {
      excludeExtraneousValues: true,
    });
  }
}
