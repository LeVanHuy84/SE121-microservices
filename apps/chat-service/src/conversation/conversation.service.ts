/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ConversationResponseDTO,
  CursorPaginationDTO,
  CursorPaginationResponseDTO,
  UpdateConversationDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, Types } from 'mongoose';
import { Conversation } from 'src/mongo/schema/conversation.schema';
const USER_CONV_KEY = (userId: string) => `user:${userId}:conversations`;
const CONV_DETAIL_KEY = (id: string) => `conv:${id}:detail`;
const CONV_PARTICIPANTS_KEY = (id: string) => `conv:${id}:participants`;
const TTL = 60 * 5;
@Injectable()
export class ConversationService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async getConversations(
    userId: string,
    { before, limit }: CursorPaginationDTO,
  ): Promise<CursorPaginationResponseDTO<ConversationResponseDTO>> {
    const key = USER_CONV_KEY(userId);

    if (await this.redis.exists(key)) {
      let cached: string[];
      if (before) {
        // Lấy score của conversation "before"
        const scoreStr = await this.redis.zscore(
          key,
          JSON.stringify({ _id: before }),
        );
        if (scoreStr) {
          const score = Number(scoreStr);
          // Lấy các conversation cũ hơn score này
          cached = await this.redis.zrevrangebyscore(
            key,
            score - 1,
            '-inf',
            'LIMIT',
            0,
            limit,
          );
        } else {
          cached = [];
        }
      } else {
        // Không có before → lấy mới nhất
        cached = await this.redis.zrevrange(key, 0, limit - 1);
      }

      if (cached.length) {
        const conversations = cached.map((c) => JSON.parse(c) as Conversation);
        const dtos = plainToInstance(ConversationResponseDTO, conversations);

        const nextCursor =
          conversations.length &&
          (conversations[conversations.length - 1] as { _id: any })._id
            ? (
                conversations[conversations.length - 1] as { _id: any }
              )._id.toString()
            : undefined;
        return { data: dtos, nextCursor, hasMore: !!nextCursor };
      }
    }

    const query: any = { participants: userId };
    if (before) query._id = { $lt: new Types.ObjectId(before) };

    const conversations = await this.conversationModel
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    if (conversations.length) {
      const pipeline = this.redis.pipeline();
      for (const conv of conversations) {
        const score = new Date((conv as any).updatedAt).getTime();
        pipeline.zadd(key, score, JSON.stringify(conv));
      }
      pipeline.expire(key, TTL);
      await pipeline.exec();
    }
    const dtos = plainToInstance(ConversationResponseDTO, conversations, {
      excludeExtraneousValues: true,
    });

    const nextCursor =
      conversations.length && conversations[conversations.length - 1]._id
        ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
          conversations[conversations.length - 1]._id.toString()
        : undefined;

    return {
      data: dtos,
      nextCursor,
      hasMore: !!nextCursor,
    };
  }

  async getConversationById(
    conversationId: string,
  ): Promise<ConversationResponseDTO> {
    const key = CONV_DETAIL_KEY(conversationId);
    const cached = await this.redis.get(key);
    if (cached) {
      const conv = JSON.parse(cached) as Conversation;
      return plainToInstance(ConversationResponseDTO, conv, {
        excludeExtraneousValues: true,
      });
    }

    const conversation = await this.conversationModel
      .findById(conversationId)
      .lean();
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    await this.redis.set(key, JSON.stringify(conversation), 'EX', TTL);
    return plainToInstance(ConversationResponseDTO, conversation, {
      excludeExtraneousValues: true,
    });
  }

  async getParticipantsInConversation(
    conversationId: string,
  ): Promise<string[]> {
    const key = CONV_PARTICIPANTS_KEY(conversationId);
    const cached = await this.redis.smembers(key);
    if (cached.length) {
      return cached;
    }
    const conversation = await this.conversationModel
      .findById(conversationId)
      .lean();
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const participants = conversation.participants.map((id) => id.toString());
    if (participants.length) {
      await this.redis.sadd(key, ...participants);
      await this.redis.expire(key, TTL);
    }
    return participants;
  }

  async createConversation(
    type: 'private' | 'group',
    participants: string[],
    groupName?: string,
  ): Promise<ConversationResponseDTO> {
    // Check participant count based on type
    if (type === 'private' && participants.length !== 2) {
      throw new Error(
        'Private conversations must have exactly 2 participants.',
      );
    }
    if (type === 'group' && participants.length < 3) {
      throw new Error('Group conversations must have at least 3 participants.');
    }

    // For private, check if conversation already exists
    if (type === 'private') {
      const existing = await this.conversationModel.findOne({
        type: 'private',
        participants: { $all: participants, $size: participants.length },
      });
      if (existing)
        return plainToInstance(ConversationResponseDTO, existing.toObject(), {
          excludeExtraneousValues: true,
        });
    }

    const conversation = await this.conversationModel.create({
      type,
      participants,
      groupName: type === 'group' ? groupName : undefined,
    });

    return plainToInstance(ConversationResponseDTO, conversation.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  async updateConversation(
    conversationId: string,
    updateData: UpdateConversationDTO,
  ) {
    const conversation = await this.conversationModel.findByIdAndUpdate(
      conversationId,
      updateData,
      { new: true },
    );
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    const detailKey = CONV_DETAIL_KEY(conversationId);
    const participantsKey = CONV_PARTICIPANTS_KEY(conversationId);
    await this.redis.del(detailKey, participantsKey);
    return plainToInstance(ConversationResponseDTO, conversation.toObject(), {
      excludeExtraneousValues: true,
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.conversationModel.findByIdAndDelete(conversationId);
    await this.redis.del(
      CONV_DETAIL_KEY(conversationId),
      CONV_PARTICIPANTS_KEY(conversationId),
    );
  }
}
