import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectModel } from '@nestjs/mongoose';
import {
  CursorPageResponse,
  CursorPaginationDTO,
  EventTopic,
  MediaEventType,
  MessageResponseDTO,
  SendMessageDTO,
} from '@repo/dtos';
import { Model, Types } from 'mongoose';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import {
  Conversation,
  ConversationDocument,
} from 'src/mongo/schema/conversation.schema';

import { ConversationService } from 'src/conversation/conversation.service';
import { populateAndMapMessage } from 'src/utils/mapping';
import { MessageCacheService } from './message-cache.service';
import { plainToInstance } from 'class-transformer';

import { ChatStreamProducerService } from 'src/chat-stream-producer/chat-stream-producer.service';
import { OutboxService } from 'src/outbox/outbox.service';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,

    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,

    private readonly conversationService: ConversationService,

    private readonly msgCache: MessageCacheService,

    private readonly messageStreamProducer: ChatStreamProducerService,
    private readonly outboxService: OutboxService,
  ) {}

  // ============= HISTORY =============

  async getMessagesInConversation(
    userId: string,
    conversationId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<MessageResponseDTO>> {
    // check có ở trong conv không
    const conv = await this.conversationModel
      .findById(conversationId)
      .lean()
      .exec();

    if (!conv) throw new RpcException('Conversation not found');
    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    const limit = query.limit;

    if (!query.cursor && (await this.msgCache.hasEmptyFlag(conversationId))) {
      return new CursorPageResponse([], null, false);
    }

    const cachedPage = await this.msgCache.getMessagesPage(
      conversationId,
      query.cursor ?? null,
      limit,
    );

    if (cachedPage && cachedPage.items.length) {
      const cacheIsPartial = !query.cursor && cachedPage.items.length < limit;
      if (!cacheIsPartial) {
        return new CursorPageResponse(
          cachedPage.items.map((m) =>
            plainToInstance(MessageResponseDTO, m, {
              excludeExtraneousValues: true,
            }),
          ),
          cachedPage.nextCursor,
          cachedPage.hasNext,
        );
      }
      this.logger.debug(
        `Message cache partial for conversationId=${conversationId}, falling back to DB`,
      );
    }

    const dbFilter: any = {
      conversationId: new Types.ObjectId(conversationId),
    };
    if (query.cursor) {
      dbFilter.createdAt = { $lt: new Date(Number(query.cursor)) };
    }

    const items = await this.messageModel
      .find(dbFilter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .exec();

    if (!items.length) {
      await this.msgCache.markEmpty(conversationId);
      return new CursorPageResponse([], null, false);
    }

    const hasNext = items.length > limit;
    const sliced = items.slice(0, limit);

    const mapped = sliced.map((m) => populateAndMapMessage(m)!);

    await this.msgCache.cacheMessages(conversationId, mapped);

    const last = mapped[mapped.length - 1];
    const nextCursor =
      hasNext && last?.createdAt
        ? new Date(last.createdAt).getTime().toString()
        : null;

    return new CursorPageResponse(mapped, nextCursor, hasNext);
  }

  // ============= GET ONE =============

  async getMessageById(
    userId: string,
    messageId: string,
  ): Promise<MessageResponseDTO> {
    const cached = await this.msgCache.getMessageDetail(messageId);
    if (cached) {
      // check quyền qua conversationService
      await this.conversationService.getConversationById(
        userId,
        cached.conversationId,
      );
      return plainToInstance(MessageResponseDTO, cached, {
        excludeExtraneousValues: true,
      });
    }

    const msg = await this.messageModel
      .findById(messageId)
      .populate('replyTo')
      .exec();

    if (!msg) throw new RpcException('Message not found');

    const conv = await this.conversationModel
      .findById(msg.conversationId)
      .lean()
      .exec();

    if (!conv || !conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    const dto = populateAndMapMessage(msg)!;

    await Promise.all([
      this.msgCache.setMessageDetail(dto),
      this.msgCache.upsertMessageToConversationList(dto.conversationId, dto),
    ]);

    return dto;
  }

  // ============= SEND MESSAGE =============

  async sendMessage(
    userId: string,
    dto: SendMessageDTO,
  ): Promise<MessageResponseDTO> {
    const conv = await this.conversationModel
      .findById(dto.conversationId)
      .exec();

    if (!conv) throw new RpcException('Conversation not found');
    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    const msg = new this.messageModel({
      conversationId: conv._id,
      senderId: userId,
      content: dto.content,
      attachments: dto.attachments,
      replyTo: dto.replyTo ? new Types.ObjectId(dto.replyTo) : undefined,
      seenBy: [userId],
      status: 'sent',
    });

    await msg.save();

    if (msg.replyTo) {
      await msg.populate('replyTo');
    }

    // cập nhật lastMessage + updatedAt conversation
    conv.lastMessage = msg._id as any;
    await conv.save();

    const convDto =
      await this.conversationService.updateConversationCache(conv);
    const dtoMsg = populateAndMapMessage(msg)!;

    const tasks: Promise<unknown>[] = [
      this.msgCache.setMessageDetail(dtoMsg),
      this.msgCache.upsertMessageToConversationList(dto.conversationId, dtoMsg),
      this.messageStreamProducer.publishMessageCreated(dtoMsg),
    ];

    if (convDto) {
      tasks.push(
        this.messageStreamProducer.publishConversationUpdated(convDto),
      );
    }

    await Promise.all(tasks);

    await this.enqueueMediaAssignEvent(msg, msg._id.toString());
    return dtoMsg;
  }

  // ============= EDIT MESSAGE =============

  // async editMessage(
  //   userId: string,
  //   messageId: string,
  //   dto: EditMessageDTO,
  // ): Promise<MessageResponseDTO> {
  //   const msg = await this.messageModel.findById(messageId).exec();
  //   if (!msg) throw new RpcException('Message not found');

  //   if (msg.senderId !== userId) {
  //     throw new RpcException('You can only edit your own message');
  //   }

  //   if (dto.content !== undefined) msg.content = dto.content;
  //   if (dto.attachments !== undefined) msg.attachments = dto.attachments;

  //   await msg.save();
  //   return populateAndMapMessage(msg)!;
  // }

  // ============= DELETE MESSAGE =============

  async deleteMessage(
    userId: string,
    messageId: string,
    forEveryone = true,
  ): Promise<MessageResponseDTO> {
    const msg = await this.messageModel.findById(messageId).exec();
    if (!msg) throw new RpcException('Message not found');

    if (msg.senderId !== userId) {
      // tuỳ bà cho admin xoá hay không
      throw new RpcException('You can only delete your own message');
    }

    // soft delete
    msg.isDeleted = true;
    msg.deletedAt = new Date();
    // msg.content = ''; // hoặc để nguyên và hide ở FE
    await msg.save();

    const dtoMsg = populateAndMapMessage(msg)!;
    const conv = await this.conversationModel
      .findById(dtoMsg.conversationId)
      .exec();
    const shouldUpdateConversation =
      !!conv?.lastMessage && conv.lastMessage.toString() === dtoMsg._id;
    const convDto = shouldUpdateConversation
      ? await this.conversationService.updateConversationCache(conv)
      : null;

    const tasks: Promise<unknown>[] = [
      // Keep detail cache and list in sync after delete.
      this.msgCache.setMessageDetail(dtoMsg),

      this.msgCache.upsertMessageToConversationList(
        dtoMsg.conversationId,
        dtoMsg,
      ),
      this.messageStreamProducer.publishMessageDeleted(dtoMsg),
    ];

    if (convDto) {
      tasks.push(
        this.messageStreamProducer.publishConversationUpdated(convDto),
      );
    }

    await Promise.all(tasks);

    await this.enqueueMediaDeleteEvent(msg, messageId);
    return dtoMsg;
  }

  private async enqueueMediaDeleteEvent(
    msg: MessageDocument,
    messageId: string,
  ) {
    const items =
      msg.attachments
        ?.map((att) => {
          if (!att?.publicId) return null;
          const resourceType =
            att.mimeType && att.mimeType.startsWith('video/')
              ? 'video'
              : 'image';
          return { publicId: att.publicId, resourceType };
        })
        .filter(Boolean) || [];

    if (items.length === 0) return;

    await this.outboxService.enqueue(
      EventTopic.MEDIA,
      MediaEventType.DELETE_REQUESTED,
      {
        items: items as {
          publicId: string;
          resourceType?: 'image' | 'video';
        }[],
        source: 'chat-service',
        reason: 'message.deleted',
      },
      messageId,
    );
  }

  private async enqueueMediaAssignEvent(
    msg: MessageDocument,
    messageId: string,
  ) {
    const items =
      msg.attachments
        ?.map((att) => {
          if (!att?.publicId) return null;
          const resourceType =
            att.mimeType && att.mimeType.startsWith('video/')
              ? 'video'
              : 'image';
          return {
            publicId: att.publicId,
            url: att.url,
            type: resourceType,
          };
        })
        .filter(Boolean) || [];

    if (items.length === 0) return;

    await this.outboxService.enqueue(
      EventTopic.MEDIA,
      MediaEventType.CONTENT_ID_ASSIGNED,
      {
        contentId: messageId,
        items: items as {
          publicId: string;
          url?: string;
          type?: 'image' | 'video';
        }[],
        source: 'chat-service',
      },
      messageId,
    );
  }

  // ============= REACTION =============

  // async reactToMessage(
  //   userId: string,
  //   messageId: string,
  //   emoji: string,
  // ): Promise<MessageResponseDTO> {
  //   const msg = await this.messageModel.findById(messageId).exec();
  //   if (!msg) throw new RpcException('Message not found');

  //   const reactions = msg.reactions || [];
  //   const index = reactions.findIndex((r) => r.userId === userId);

  //   if (index >= 0) {
  //     reactions[index].emoji = emoji;
  //   } else {
  //     reactions.push({ userId, emoji });
  //   }

  //   msg.reactions = reactions;
  //   await msg.save();

  //   const dtoMsg = populateAndMapMessage(msg)!;

  //   await this.msgCache.setMessageDetail(dtoMsg);
  //   await this.msgCache.cacheMessages(msg.conversationId.toString(), [dtoMsg]);

  //   return dtoMsg;
  // }

  // async removeReaction(
  //   userId: string,
  //   messageId: string,
  // ): Promise<MessageResponseDTO> {
  //   const msg = await this.messageModel.findById(messageId).exec();
  //   if (!msg) throw new RpcException('Message not found');

  //   msg.reactions = (msg.reactions || []).filter((r) => r.userId !== userId);

  //   await msg.save();

  //   const dtoMsg = populateAndMapMessage(msg)!;

  //   await this.msgCache.setMessageDetail(dtoMsg);
  //   await this.msgCache.cacheMessages(msg.conversationId.toString(), [dtoMsg]);

  //   return dtoMsg;
  // }
}
