/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ConversationResponseDTO,
  CursorPaginationDTO,
  CursorPaginationResponseDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Model, Types } from 'mongoose';
import { Conversation } from 'src/mongo/schema/conversation.schema';

@Injectable()
export class ConversationService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
  ) {}

  async getConversations(
    userId: string,
    { before, limit }: CursorPaginationDTO,
  ): Promise<CursorPaginationResponseDTO<ConversationResponseDTO>> {
    const query: any = { participants: userId };
    if (before) query._id = { $lt: new Types.ObjectId(before) };

    const conversations = await this.conversationModel
      .find(query)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();

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
}
