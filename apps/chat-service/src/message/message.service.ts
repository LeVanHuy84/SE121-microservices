/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CursorPaginationDTO,
  CursorPaginationResponseDTO,
  MessageResponseDTO,
  SendMessageDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, Types } from 'mongoose';
import { Message } from 'src/mongo/schema/message.schema';

@Injectable()
export class MessageService {
  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async getMessages(
    conversationId: string,
    { before, after, limit }: CursorPaginationDTO,
  ): Promise<CursorPaginationResponseDTO<MessageResponseDTO>> {
    const key = `conv:${conversationId}:messages`;

    if (await this.redis.exists(key)) {
      let ids: string[];

      if (before) {
        // Lấy score của message 'before' để paginate
        const score = await this.redis.zscore(key, before);
        ids =
          score !== null
            ? await this.redis.zrevrangebyscore(
                key,
                Number(score) - 1,
                '-inf',
                'LIMIT',
                0,
                limit,
              )
            : [];
      } else if (after) {
        const score = await this.redis.zscore(key, after);
        ids =
          score !== null
            ? await this.redis.zrangebyscore(
                key,
                Number(score) + 1,
                '+inf',
                'LIMIT',
                0,
                limit,
              )
            : [];
      } else {
        ids = await this.redis.zrevrange(key, 0, limit - 1);
      }

      if (ids.length) {
        const msgsRaw = await this.redis.mget(ids.map((id) => `msg:${id}`));
        type CachedMessage = { _id: Types.ObjectId | string } & Record<
          string,
          unknown
        >;
        const messages: CachedMessage[] = msgsRaw
          .map((raw) => (raw ? (JSON.parse(raw) as unknown) : null))
          .filter(
            (m): m is CachedMessage =>
              !!m && typeof m === 'object' && '_id' in m,
          );

        const dtos = plainToInstance(MessageResponseDTO, messages.reverse(), {
          excludeExtraneousValues: true,
        });
        const nextCursor = messages.length
          ? messages[messages.length - 1]._id.toString()
          : undefined;

        return { data: dtos, nextCursor, hasMore: !!nextCursor };
      }
    }

    const query: any = { conversationId };

    if (before) query._id = { $lt: new Types.ObjectId(before) };
    if (after) query._id = { $gt: new Types.ObjectId(after) };

    const messages = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    if (messages.length) {
      const pipeline = this.redis.pipeline();
      for (const msg of messages) {
        const msgKey = `msg:${msg._id}`;
        const score = new Date((msg as any).createdAt).getTime();
        pipeline.set(msgKey, JSON.stringify(msg), 'EX', 60 * 60 * 6); // 6h TTL
        pipeline.zadd(key, score, msg._id.toString());
      }
      pipeline.zremrangebyrank(key, 0, -201); // giữ 200 mới nhất
      pipeline.expire(key, 60 * 60 * 6);
      await pipeline.exec();
    }

    const dtos = plainToInstance(MessageResponseDTO, messages.reverse(), {
      excludeExtraneousValues: true,
    });

    const nextCursor = messages.length
      ? messages[messages.length - 1]._id.toString()
      : undefined;

    return {
      data: dtos,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }

  async createMessage(
    conversationId: string,
    senderId: string,
    dto: SendMessageDTO,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.create({
      conversationId,
      senderId,
      messageType: dto.messageType,
      content: dto.content,
      attachments: dto.messageType !== 'text' ? dto.attachments : [],
      status: 'sent',
    });
    const msgObj = msg.toObject();
    const msgKey = `msg:${msg._id}`;
    const listKey = `conv:${conversationId}:messages`;
    const score = new Date((msgObj as any).createdAt).getTime();

    const pipeline = this.redis.pipeline();
    pipeline.set(msgKey, JSON.stringify(msgObj), 'EX', 60 * 60 * 6);
    pipeline.zadd(listKey, score, (msgObj as any)._id.toString());
    pipeline.zremrangebyrank(listKey, 0, -201);
    pipeline.expire(listKey, 60 * 60 * 6);
    await pipeline.exec();
    return plainToInstance(MessageResponseDTO, msg.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  async markSeen(
    messageId: string,
    userId: string,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');

    if (!msg.seenBy.includes(userId)) {
      msg.seenBy.push(userId);
      msg.status = 'seen';
      await msg.save();
    }

    return plainToInstance(MessageResponseDTO, msg.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  async reactMessage(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.findById(messageId);
    if (!msg) throw new NotFoundException('Message not found');

    const existing = msg.reactions.find((r) => r.userId === userId);
    if (existing) {
      existing.emoji = emoji;
    } else {
      msg.reactions.push({ userId, emoji });
    }
    await msg.save();

    return plainToInstance(MessageResponseDTO, msg.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  async deleteMessage(messageId: string) {
    const msg = await this.messageModel.findByIdAndDelete(messageId);
    if (!msg) throw new NotFoundException('Message not found');

    const msgKey = `msg:${messageId}`;
    const listKey = `conv:${msg.conversationId}:messages`;

    const pipeline = this.redis.pipeline();
    pipeline.del(msgKey);
    pipeline.zrem(listKey, messageId);
    await pipeline.exec();
  }
}
