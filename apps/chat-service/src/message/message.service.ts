import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  CursorPageResponse,
  CursorPaginationDTO,
  EventTopic,
  MEDIA_UPLOAD_MAX_BYTES,
  MediaType,
  MediaEventType,
  MessageResponseDTO,
  SendMessageDTO,
} from '@repo/dtos';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import {
  Conversation,
  ConversationDocument,
} from 'src/mongo/schema/conversation.schema';

import { ConversationService } from 'src/conversation/conversation.service';
import {
  populateAndMapConversation,
  populateAndMapMessage,
} from 'src/utils/mapping';
import { MessageCacheService } from './message-cache.service';
import { plainToInstance } from 'class-transformer';

import { OutboxService } from 'src/outbox/outbox.service';
import { ChatPushService } from 'src/push/chat-push.service';

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

    private readonly outboxService: OutboxService,
    private readonly chatPushService: ChatPushService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const result = await work(session);
      await session.commitTransaction();
      await this.outboxService.flushPendingChatEvents(session);
      return result;
    } catch (error) {
      await session.abortTransaction();
      this.outboxService.clearPendingChatEvents(session);
      throw error;
    } finally {
      this.outboxService.clearPendingChatEvents(session);
      await session.endSession();
    }
  }

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
  this.validateAttachments(dto.attachments);

  const { conversation, dtoMsg } = await this.withTransaction(async (session) => {
    const conversation = await this.conversationModel
      .findOne({
        _id: dto.conversationId,
        participants: userId,
      })
      .session(session)
      .exec();

    if (!conversation) {
      throw new RpcException('Conversation not found or access denied');
    }

    let replyMessage: MessageDocument | null = null;
    if (dto.replyTo) {
      replyMessage = await this.messageModel
        .findById(dto.replyTo)
        .select('_id conversationId senderId content attachments createdAt')
        .session(session)
        .exec();

      if (!replyMessage) {
        throw new RpcException('Reply message not found');
      }

      if (replyMessage.conversationId.toString() !== dto.conversationId) {
        throw new RpcException(
          'Reply message does not belong to this conversation',
        );
      }
    }

    const msg = await new this.messageModel({
      conversationId: conversation._id,
      senderId: userId,
      content: dto.content,
      attachments: dto.attachments,
      replyTo: replyMessage?._id,
      seenBy: [userId],
      status: 'sent',
    }).save({ session });

    await this.conversationModel.updateOne(
      { _id: conversation._id },
      {
        $set: {
          lastMessage: msg._id,
          updatedAt: new Date(),
        },
      },
      { session },
    );

    const dtoMsg = populateAndMapMessage({
      ...msg.toObject(),
      replyTo: replyMessage ? replyMessage.toObject() : undefined,
    })!;

    await this.outboxService.enqueueChatEvent(
      'message.created',
      dtoMsg,
      dto.conversationId,
      session,
    );

    await this.outboxService.enqueueChatEvent(
      'conversation.updated',
      {
        ...populateAndMapConversation(conversation),
        lastMessage: dtoMsg,
      },
      conversation._id.toString(),
      session,
    );

    if (dto.attachments?.length) {
      await this.enqueueMediaAssignEvent(msg, msg._id.toString(), session);
    }

    return { conversation, dtoMsg };
  });

  await Promise.allSettled([
    this.conversationService.updateConversationCache(conversation),
    this.msgCache.setMessageDetail(dtoMsg),
    this.msgCache.upsertMessageToConversationList(dto.conversationId, dtoMsg),
  ]);

  try {
    await this.chatPushService.sendMessagePush({
      senderId: userId,
      conversationId: dto.conversationId,
      conversationName: conversation.groupName,
      isGroup: conversation.isGroup,
      receiverIds: conversation.participants.filter(
        (participantId) => participantId.toString() !== userId,
      ),
      messageId: dtoMsg._id,
      preview: this.buildPushPreview(dtoMsg.content, dtoMsg.attachments),
    });
  } catch (error) {
    this.logger.warn('Failed to send push notification', error);
  }

  return dtoMsg;
}

  private validateAttachments(attachments?: SendMessageDTO['attachments']) {
    if (!attachments?.length) {
      return;
    }

    for (const attachment of attachments) {
      if (
        typeof attachment.size !== 'number' ||
        !Number.isFinite(attachment.size) ||
        attachment.size < 0
      ) {
        throw new RpcException('Attachment size is required');
      }

      const type = this.resolveAttachmentType(attachment);
      const maxSize = MEDIA_UPLOAD_MAX_BYTES[type];

      if (attachment.size > maxSize) {
        throw new RpcException(
          `File exceeds the ${type} upload limit of ${maxSize} bytes`,
        );
      }
    }
  }

  private buildPushPreview(
    content?: string | null,
    attachments?: Array<{ type?: MediaType }>,
  ) {
    const trimmedContent = content?.trim();
    if (trimmedContent) {
      return trimmedContent;
    }

    if (!attachments?.length) {
      return 'Bạn có tin nhắn mới';
    }

    const attachmentType = attachments[0]?.type;
    switch (attachmentType) {
      case MediaType.IMAGE:
        return 'Đã gửi một ảnh';
      case MediaType.VIDEO:
        return 'Đã gửi một video';
      case MediaType.AUDIO:
        return 'Đã gửi một audio';
      case MediaType.FILE:
      default:
        return 'Đã gửi một file đính kèm';
    }
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
    let msg: MessageDocument | null = null;
    let dtoMsg!: MessageResponseDTO;
    let conv: ConversationDocument | null = null;
    let shouldUpdateConversation = false;

    await this.withTransaction(async (session) => {
      msg = await this.messageModel.findById(messageId).session(session).exec();
      if (!msg) throw new RpcException('Message not found');

      if (msg.senderId !== userId) {
        // tuỳ bà cho admin xoá hay không
        throw new RpcException('You can only delete your own message');
      }

      // soft delete
      msg.isDeleted = true;
      msg.deletedAt = new Date();
      // msg.content = ''; // hoặc để nguyên và hide ở FE
      await msg.save({ session });

      dtoMsg = populateAndMapMessage(msg)!;
      conv = await this.conversationModel
        .findById(dtoMsg.conversationId)
        .session(session)
        .exec();
      shouldUpdateConversation =
        !!conv?.lastMessage && conv.lastMessage.toString() === dtoMsg._id;

      await this.outboxService.enqueueChatEvent(
        'message.deleted',
        dtoMsg,
        dtoMsg.conversationId,
        session,
      );

      if (conv && shouldUpdateConversation) {
        await this.outboxService.enqueueChatEvent(
          'conversation.updated',
          populateAndMapConversation(conv),
          conv._id.toString(),
          session,
        );
      }

      await this.enqueueMediaDeleteEvent(msg, messageId, session);
    });

    if (!msg) {
      throw new RpcException('Message not found');
    }

    if (conv && shouldUpdateConversation) {
      await this.conversationService.updateConversationCache(conv);
    }

    await Promise.all([
      this.msgCache.setMessageDetail(dtoMsg),
      this.msgCache.upsertMessageToConversationList(
        dtoMsg.conversationId,
        dtoMsg,
      ),
    ]);

    return dtoMsg;
  }

  private async enqueueMediaDeleteEvent(
    msg: MessageDocument,
    messageId: string,
    session?: ClientSession,
  ) {
    const items =
      msg.attachments
        ?.map((att) => {
          if (!att?.publicId) return null;
          const resourceType = this.toCloudinaryResourceType(
            this.resolveAttachmentType(att),
          );
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
          resourceType?: 'image' | 'video' | 'raw';
        }[],
        source: 'chat-service',
        reason: 'message.deleted',
      },
      messageId,
      session,
    );
  }

  private async enqueueMediaAssignEvent(
    msg: MessageDocument,
    messageId: string,
    session?: ClientSession,
  ) {
    const items =
      msg.attachments
        ?.map((att) => {
          if (!att?.publicId) return null;
          return {
            publicId: att.publicId,
            url: att.url,
            type: this.resolveAttachmentType(att),
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
          type?: MediaType;
        }[],
        source: 'chat-service',
      },
      messageId,
      session,
    );
  }

  private resolveAttachmentType(att: {
    type?: MediaType;
    mimeType?: string;
  }): MediaType {
    if (att.type) {
      return att.type;
    }
    if (att.mimeType?.startsWith('image/')) {
      return MediaType.IMAGE;
    }
    if (att.mimeType?.startsWith('video/')) {
      return MediaType.VIDEO;
    }
    if (att.mimeType?.startsWith('audio/')) {
      return MediaType.AUDIO;
    }

    return MediaType.FILE;
  }

  private toCloudinaryResourceType(type: MediaType): 'image' | 'video' | 'raw' {
    switch (type) {
      case MediaType.IMAGE:
        return 'image';
      case MediaType.VIDEO:
      case MediaType.AUDIO:
        return 'video';
      case MediaType.FILE:
      default:
        return 'raw';
    }
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
