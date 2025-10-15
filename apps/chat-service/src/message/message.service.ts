/* eslint-disable @typescript-eslint/no-base-to-string */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CursorPaginationDTO,
  CursorPaginationResponseDTO,
  MessageResponseDTO,
  SendMessageDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { Model, Types } from 'mongoose';
import { Message } from 'src/mongo/schema/message.schema';

@Injectable()
export class MessageService {
  constructor(
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
  ) {}

  async getMessages(
    conversationId: string,
    { before, after, limit }: CursorPaginationDTO,
  ): Promise<CursorPaginationResponseDTO<MessageResponseDTO>> {
    const query: any = { conversationId };

    if (before) query._id = { $lt: new Types.ObjectId(before) };
    if (after) query._id = { $gt: new Types.ObjectId(after) };

    const messages = await this.messageModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

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
}
