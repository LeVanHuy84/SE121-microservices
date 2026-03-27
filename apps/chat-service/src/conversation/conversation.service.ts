import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ConversationResponseDTO,
  CreateConversationDTO,
  CursorPageResponse,
  CursorPaginationDTO,
  EventTopic,
  MediaEventType,
  UpdateConversationDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { ClientSession, Connection, Model } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from 'src/mongo/schema/conversation.schema';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import { populateAndMapConversation } from 'src/utils/mapping';
import { ConversationCacheService } from './conversation-cache.service';
import { OutboxService } from 'src/outbox/outbox.service';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,

    private readonly cache: ConversationCacheService,
    private readonly outboxService: OutboxService,
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
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // ==================== GET BY ID ====================
  async getConversationById(
    userId: string,
    conversationId: string,
  ): Promise<ConversationResponseDTO> {
    const cached = await this.cache.getConversationDetail(conversationId);
    if (cached) {
      if (!cached.participants?.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      return plainToInstance(ConversationResponseDTO, cached, {
        excludeExtraneousValues: true,
      });
    }

    // DB fallback
    const convDoc = await this.conversationModel
      .findById(conversationId)
      .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
      .exec();

    if (!convDoc) throw new RpcException('Conversation not found');

    //  Check quyền từ DB
    if (!convDoc.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    // Chuẩn hóa bằng utils
    const dto = populateAndMapConversation(convDoc);

    await Promise.all([
      this.cache.setConversationDetail(dto),
      ...(dto.participants ?? []).map((u) =>
        this.cache.upsertConversationToUserList(u, dto),
      ),
    ]);

    return dto;
  }

  // ==================== GET CONVERSATIONS (CURSOR PAGING + REDIS ZSET) ====================
  async getConversations(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<ConversationResponseDTO>> {
    const limit = query.limit;
    // 1) Nếu đã có flag "empty" thì trả về luôn
    if (!query.cursor && (await this.cache.hasEmptyFlag(userId))) {
      return new CursorPageResponse([], null, false);
    }

    // 2) Thử lấy từ Redis ZSET + HASH
    const page = await this.cache.getUserConversationsPage(
      userId,
      query.cursor ?? null,
      limit,
    );

    if (page && page.items.length) {
      const cacheIsPartial = !query.cursor && page.items.length < limit;
      if (!cacheIsPartial) {
        return new CursorPageResponse(
          plainToInstance(ConversationResponseDTO, page.items, {
            excludeExtraneousValues: true,
          }),
          page.nextCursor,
          page.hasNext,
        );
      }
      this.logger.debug(
        `Cache partial for userId=${userId}, falling back to DB`,
      );
    }

    // Cache miss → DB fallback
    const dbFilter = query.cursor
      ? { updatedAt: { $lt: new Date(Number(query.cursor)) } }
      : {};
    const dbItems = await this.conversationModel
      .find({ participants: userId, hiddenFor: { $ne: userId }, ...dbFilter })
      .sort({ updatedAt: -1 })
      .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
      .limit(limit + 1)
      .exec();

    if (dbItems.length > 0) {
      const mapped = await Promise.all(
        dbItems.map((doc) => populateAndMapConversation(doc)),
      );

      await Promise.all([
        ...mapped.map((dto) => this.cache.setConversationDetail(dto)),
        this.cache.cacheConversationsForUsers(userId, mapped),
      ]);

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

    await this.cache.markEmpty(userId);
    return new CursorPageResponse([], null, false);
  }

  // ============ CREATE (DIRECT + GROUP) ============

  async createConversation(
    userId: string,
    dto: CreateConversationDTO,
  ): Promise<ConversationResponseDTO> {
    const participants = Array.from(
      new Set([userId, ...(dto.participants || [])]),
    );

    if (participants.length < 2) {
      throw new RpcException('Conversation must have at least 2 participants');
    }

    // Mặc định: nếu >2 user thì là group
    const isGroup = dto.isGroup ?? participants.length > 2;

    // ----- DIRECT (1–1) -----
    if (!isGroup) {
      if (participants.length !== 2) {
        throw new RpcException(
          'Direct conversation must have exactly 2 participants',
        );
      }

      const sorted = [...participants].sort();
      const directKey = sorted.join(':');

      // Tìm xem đã tồn tại conv direct chưa
      const existed = await this.conversationModel
        .findOne({ directKey })
        .populate('lastMessage')
        .exec();

      if (existed) {
        // Nếu từng bị hide với user này thì bỏ khỏi hiddenFor
        if (existed.hiddenFor?.includes(userId)) {
          existed.hiddenFor = existed.hiddenFor.filter((u) => u !== userId);
          await existed.save();
        }

        await this.updateConversationCache(existed);
        return populateAndMapConversation(existed);
      }

      // Tạo mới
      const doc = new this.conversationModel({
        isGroup: false,
        participants,
        admins: [],
      });

      let convDto!: ConversationResponseDTO;
      await this.withTransaction(async (session) => {
        await doc.save({ session });
        convDto = populateAndMapConversation(doc);
        await this.outboxService.enqueueChatEvent(
          'conversation.created',
          convDto,
          convDto._id,
          session,
        );
      });

      await this.updateConversationCache(doc);
      return convDto;
    }

    if (!dto.groupName || dto.groupName.trim().length === 0) {
      throw new RpcException('Group name cannot be empty string');
    }

    // ----- GROUP -----
    const doc = new this.conversationModel({
      isGroup: true,
      participants,
      groupName: dto.groupName,
      groupAvatar: dto.groupAvatar,
      admins: [userId],
    });

    let convDto!: ConversationResponseDTO;
    await this.withTransaction(async (session) => {
      await doc.save({ session });
      convDto = populateAndMapConversation(doc);
      await this.outboxService.enqueueChatEvent(
        'conversation.created',
        convDto,
        convDto._id,
        session,
      );
      if (dto.groupAvatar?.publicId) {
        await this.enqueueGroupAvatarAssign(
          convDto._id,
          dto.groupAvatar,
          session,
        );
      }
    });

    await this.updateConversationCache(doc);

    return convDto;
  }

  // ============ UPDATE GROUP ============

  async updateConversation(
    userId: string,
    conversationId: string,
    dto: UpdateConversationDTO,
  ): Promise<ConversationResponseDTO> {
    let conv: ConversationDocument | null = null;
    let convDto!: ConversationResponseDTO;
    let toRemove: string[] = [];

    await this.withTransaction(async (session) => {
      conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();

      if (!conv) throw new RpcException('Conversation not found');
      if (!conv.isGroup) {
        throw new RpcException('Cannot update direct conversation');
      }
      if (!conv.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }
      if (!conv.admins?.includes(userId)) {
        throw new RpcException('You are not admin of this conversation');
      }

      const previousGroupAvatar = conv.groupAvatar;

      if (dto.groupName !== undefined) conv.groupName = dto.groupName;
      if (dto.groupAvatar !== undefined) conv.groupAvatar = dto.groupAvatar;

      const toAdd = Array.isArray(dto.participantsToAdd)
        ? dto.participantsToAdd
        : [];
      toRemove = Array.isArray(dto.participantsToRemove)
        ? dto.participantsToRemove
        : [];

      if (toAdd.length) {
        const existing = new Set(conv.participants);
        const dup = toAdd.find((p) => existing.has(p));
        if (dup) {
          throw new RpcException(
            'Some participants are already in the conversation',
          );
        }
      }

      // Thêm member
      if (toAdd.length) {
        const set = new Set(conv.participants);
        toAdd.forEach((p) => set.add(p));
        conv.participants = Array.from(set);
      }

      // Xóa member
      if (toRemove.length) {
        const rm = new Set(toRemove);
        conv.participants = conv.participants.filter((p) => !rm.has(p));
        conv.admins = (conv.admins || []).filter((a) => !rm.has(a));
        conv.hiddenFor = (conv.hiddenFor || []).filter((u) => !rm.has(u));
      }

      // // Thêm admin
      // if (dto.addAdmins?.length) {
      //   const set = new Set(conv.admins || []);
      //   dto.addAdmins.forEach((a) => {
      //     if (conv.participants.includes(a)) set.add(a);
      //   });
      //   conv.admins = Array.from(set);
      // }

      // // Xóa admin
      // if (dto.removeAdmins?.length) {
      //   const rm = new Set(dto.removeAdmins);
      //   conv.admins = (conv.admins || []).filter((a) => !rm.has(a));
      //   if (!conv.admins.length) {
      //     throw new RpcException('Conversation must have at least 1 admin');
      //   }
      // }

      await conv.save({ session });
      convDto = populateAndMapConversation(conv);

      // 🔥 event: conversation updated
      if (dto.groupAvatar !== undefined) {
        if (dto.groupAvatar?.publicId) {
          await this.enqueueGroupAvatarAssign(
            conversationId,
            dto.groupAvatar,
            session,
          );
        }

        const prevPublicId = previousGroupAvatar?.publicId;
        const nextPublicId = dto.groupAvatar?.publicId;
        if (prevPublicId && prevPublicId !== nextPublicId) {
          await this.enqueueGroupAvatarDelete(
            conversationId,
            prevPublicId,
            undefined,
            session,
          );
        }
      }

      await this.outboxService.enqueueChatEvent(
        'conversation.updated',
        convDto,
        convDto._id,
        session,
      );

      // 🔥 event: memberJoined
      if (toAdd.length) {
        await this.outboxService.enqueueChatEvent(
          'conversation.memberJoined',
          {
            conversation: convDto,
            joinedUserIds: toAdd,
          },
          convDto._id,
          session,
        );
      }

      // 🔥 event: memberLeft
      if (toRemove.length) {
        await this.outboxService.enqueueChatEvent(
          'conversation.memberLeft',
          {
            conversationId,
            leftUserIds: toRemove,
          },
          conversationId,
          session,
        );
      }
    });

    if (!conv) {
      throw new RpcException('Conversation not found');
    }

    await this.updateConversationCache(conv);
    if (toRemove.length) {
      await Promise.all(
        toRemove.map((leftUserId) =>
          this.cache.removeConversationFromUser(leftUserId, conversationId),
        ),
      );
    }

    return convDto;
  }

  async markConversationAsRead(
    userId: string,
    conversationId: string,
    lastMessageId?: string,
  ): Promise<string | null> {
    let updatedConversationId: string | null = null;
    let result: string | null = null;

    await this.withTransaction(async (session) => {
      const conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();
      if (!conv) throw new RpcException('Conversation not found');
      if (!conv.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      let targetMsg: MessageDocument | null = null;

      if (lastMessageId) {
        targetMsg = await this.messageModel
          .findById(lastMessageId)
          .session(session)
          .exec();
        if (!targetMsg) throw new RpcException('Message not found');
        if (targetMsg.conversationId.toString() !== conversationId) {
          throw new RpcException('Message does not belong to this conversation');
        }
      } else {
        if (!conv.lastMessage) {
          result = null;
          return;
        }

        targetMsg = await this.messageModel
          .findById(conv.lastMessage)
          .session(session)
          .exec();
        if (!targetMsg) {
          result = null;
          return;
        }
      }

      const targetId = targetMsg._id.toString();
      const prevId = conv.lastSeenMessageId?.get(userId);

      if (prevId && prevId === targetId) {
        result = prevId;
        return;
      }

      if (prevId) {
        const previousMessage = await this.messageModel
          .findById(prevId)
          .session(session)
          .exec();

        if (
          previousMessage &&
          (previousMessage as any).createdAt >= (targetMsg as any).createdAt
        ) {
          result = prevId;
          return;
        }
      }

      await this.messageModel.updateMany(
        {
          conversationId: conv._id,
          _id: { $lte: targetMsg._id },
          senderId: { $ne: userId },
          seenBy: { $ne: userId },
        },
        {
          $addToSet: { seenBy: userId },
        },
        { session },
      );

      await this.conversationModel.updateOne(
        { _id: conv._id },
        {
          $set: {
            [`lastSeenMessageId.${userId}`]: targetId,
            syncVersion: Date.now(),
          },
        },
        { timestamps: false, session } as any,
      );

      await this.outboxService.enqueueChatEvent(
        'conversation.read',
        {
          conversationId,
          userId,
          lastSeenMessageId: targetId,
        },
        conversationId,
        session,
      );

      updatedConversationId = conv._id.toString();
      result = targetId;
    });

    if (updatedConversationId) {
      await this.refreshConversationCache(updatedConversationId);
    }

    return result;
  }
  // ============ LEAVE GROUP ============

  async leaveConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    let updatedConversationId: string | null = null;
    let deletedParticipants: string[] | null = null;
    let message = 'You have left the conversation';

    await this.withTransaction(async (session) => {
      const conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();

      if (!conv) throw new RpcException('Conversation not found');

      if (!conv.isGroup) {
        throw new RpcException('Cannot leave direct conversation');
      }

      if (!conv.participants.includes(userId)) {
        message = 'You are not in this conversation';
        return;
      }

      const previousParticipants = [...(conv.participants || [])];

      conv.participants = conv.participants.filter((p) => p !== userId);
      conv.admins = (conv.admins || []).filter((a) => a !== userId);
      conv.hiddenFor = (conv.hiddenFor || []).filter((u) => u !== userId);

      if (!conv.participants.length) {
        await this.hardDeleteConversation(conv, previousParticipants, session);
        await this.outboxService.enqueueChatEvent(
          'conversation.deleted',
          {
            conversationId,
            participants: previousParticipants,
          },
          conversationId,
          session,
        );

        deletedParticipants = previousParticipants;
        message = 'Conversation deleted because the last participant left';
        return;
      }

      if (!conv.admins.length) {
        conv.admins = [conv.participants[0]];
      }

      await conv.save({ session });

      const fullConv = await this.conversationModel
        .findById(conv._id)
        .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
        .session(session)
        .exec();
      if (!fullConv) {
        throw new RpcException('Conversation not found');
      }

      const convDto = populateAndMapConversation(fullConv);

      await this.outboxService.enqueueChatEvent(
        'conversation.memberLeft',
        {
          conversationId,
          leftUserIds: [userId],
        },
        conversationId,
        session,
      );
      await this.outboxService.enqueueChatEvent(
        'conversation.updated',
        convDto,
        convDto._id,
        session,
      );

      updatedConversationId = fullConv._id.toString();
    });

    if (deletedParticipants) {
      await this.cache.removeConversationGlobally(
        conversationId,
        deletedParticipants,
      );
      return { message };
    }

    if (!updatedConversationId) {
      return { message };
    }

    await this.refreshConversationCache(updatedConversationId);
    await this.cache.removeConversationFromUser(userId, conversationId);

    return { message };
  }
  // ============ DELETE CONVERSATION ============

  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<{
    message: string;
  }> {
    const existingConversation = await this.conversationModel
      .findById(conversationId)
      .exec();

    if (!existingConversation) {
      throw new RpcException('Conversation not found');
    }

    if (!existingConversation.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    if (!existingConversation.isGroup) {
      return {
        message:
          'Direct conversation cannot be deleted, only hidden locally by client',
      };
    }

    let deletedParticipants: string[] = [];

    await this.withTransaction(async (session) => {
      const conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();

      if (!conv) throw new RpcException('Conversation not found');

      if (!conv.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      if (!conv.admins?.includes(userId)) {
        throw new RpcException('You are not admin of this conversation');
      }

      deletedParticipants = [...(conv.participants || [])];

      await this.hardDeleteConversation(conv, undefined, session);
      await this.outboxService.enqueueChatEvent(
        'conversation.deleted',
        {
          conversationId,
          participants: deletedParticipants,
        },
        conversationId,
        session,
      );
    });

    await this.cache.removeConversationGlobally(
      conversationId,
      deletedParticipants,
    );

    return { message: 'Conversation deleted' };
  }
  // ============ HIDE / UNHIDE (APPLY CHO CẢ GROUP & DIRECT) ============

  async hideConversationForUser(
    userId: string,
    conversationId: string,
  ): Promise<{
    message: string;
  }> {
    let updatedConversationId: string | null = null;

    await this.withTransaction(async (session) => {
      const conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();

      if (!conv) throw new RpcException('Conversation not found');
      if (!conv.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      if (conv.hiddenFor?.includes(userId)) {
        return;
      }

      conv.hiddenFor = [...(conv.hiddenFor || []), userId];
      await conv.save({ session });

      await this.outboxService.enqueueChatEvent(
        'conversation.hidden',
        {
          conversationId,
          userId,
        },
        conversationId,
        session,
      );

      updatedConversationId = conv._id.toString();
    });

    if (updatedConversationId) {
      await this.refreshConversationCache(updatedConversationId);
    }

    return {
      message: 'Conversation hidden',
    };
  }

  async unhideConversationForUser(
    userId: string,
    conversationId: string,
  ): Promise<{
    message: string;
  }> {
    let updatedConversationId: string | null = null;

    await this.withTransaction(async (session) => {
      const conv = await this.conversationModel
        .findById(conversationId)
        .session(session)
        .exec();

      if (!conv) throw new RpcException('Conversation not found');
      if (!conv.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      if (!conv.hiddenFor?.includes(userId)) {
        return;
      }

      conv.hiddenFor = conv.hiddenFor.filter((u) => u !== userId);
      await conv.save({ session });

      const fullConv = await this.conversationModel
        .findById(conv._id)
        .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
        .session(session)
        .exec();
      if (!fullConv) {
        throw new RpcException('Conversation not found');
      }

      const convDto = populateAndMapConversation(fullConv);
      await this.outboxService.enqueueChatEvent(
        'conversation.unhidden',
        {
          userId,
          conversation: convDto,
        },
        conversationId,
        session,
      );

      updatedConversationId = fullConv._id.toString();
    });

    if (!updatedConversationId) {
      return {
        message: 'Conversation was not hidden',
      };
    }

    await this.refreshConversationCache(updatedConversationId);

    return {
      message: 'Conversation unhidden',
    };
  }
  // ============ HARD DELETE (group) ============

  private async hardDeleteConversation(
    conv: ConversationDocument,
    _participantsOverride?: string[],
    session?: ClientSession,
  ) {
    const convId = conv._id.toString();

    await this.enqueueConversationMediaDelete(convId, conv._id, session);

    await this.conversationModel.deleteOne(
      { _id: conv._id },
      session ? { session } : undefined,
    );
    await this.messageModel.deleteMany(
      { conversationId: conv._id },
      session ? { session } : undefined,
    );
  }
  private async enqueueConversationMediaDelete(
    conversationId: string,
    conversationObjectId: any,
    session?: ClientSession,
  ) {
    const messages = await this.messageModel
      .find({ conversationId: conversationObjectId }, { attachments: 1 })
      .session(session ?? null)
      .lean()
      .exec();

    const items =
      messages
        .flatMap((msg) => msg.attachments || [])
        .map((att) => {
          if (!att?.publicId) return null;
          const resourceType =
            att.mimeType && att.mimeType.startsWith('video/')
              ? 'video'
              : 'image';
          return { publicId: att.publicId, resourceType };
        })
        .filter(Boolean) || [];

    if (items.length === 0) return;

    const chunkSize = 100;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize) as {
        publicId: string;
        resourceType?: 'image' | 'video';
      }[];

      try {
        await this.outboxService.enqueue(
          EventTopic.MEDIA,
          MediaEventType.DELETE_REQUESTED,
          {
            items: chunk,
            source: 'chat-service',
            reason: 'conversation.deleted',
            conversationId,
          },
          conversationId,
          session,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to enqueue media delete for conversationId=${conversationId}: ${error.message}`,
        );
      }
    }
  }

  private async enqueueGroupAvatarAssign(
    conversationId: string,
    avatar: { publicId?: string; url?: string; mimeType?: string },
    session?: ClientSession,
  ) {
    if (!avatar?.publicId) return;

    const type =
      avatar.mimeType && avatar.mimeType.startsWith('video/')
        ? 'video'
        : 'image';

    await this.outboxService.enqueue(
      EventTopic.MEDIA,
      MediaEventType.CONTENT_ID_ASSIGNED,
      {
        contentId: conversationId,
        items: [
          {
            publicId: avatar.publicId,
            url: avatar.url,
            type,
          },
        ],
        source: 'chat-service',
      },
      conversationId,
      session,
    );
  }

  private async enqueueGroupAvatarDelete(
    conversationId: string,
    publicId: string,
    mimeType?: string,
    session?: ClientSession,
  ) {
    const resourceType =
      mimeType && mimeType.startsWith('video/') ? 'video' : 'image';

    await this.outboxService.enqueue(
      EventTopic.MEDIA,
      MediaEventType.DELETE_REQUESTED,
      {
        items: [
          {
            publicId,
            resourceType,
          },
        ],
        source: 'chat-service',
        reason: 'conversation.groupAvatar.updated',
        conversationId,
      },
      conversationId,
      session,
    );
  }

  // ============ UPDATE CACHE SAU KHI CONV THAY ĐỔI ============

  private async refreshConversationCache(conversationId: string) {
    return this.updateConversationCache({
      _id: conversationId,
    } as unknown as ConversationDocument);
  }

  async updateConversationCache(
    conv: ConversationDocument,
  ): Promise<ConversationResponseDTO | null> {
    const fullConv = await this.conversationModel
      .findById(conv._id)
      .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
      .exec();

    if (!fullConv) return null;

    const dto = populateAndMapConversation(fullConv);
    const hiddenUsers = new Set(fullConv.hiddenFor || []);
    const visibleUsers = (fullConv.participants || []).filter(
      (userId) => !hiddenUsers.has(userId),
    );

    await Promise.all([
      this.cache.setConversationDetail(dto),
      ...visibleUsers.map((userId) =>
        this.cache.upsertConversationToUserList(userId, dto),
      ),
      ...Array.from(hiddenUsers).map((userId) =>
        this.cache.removeConversationFromUser(userId, dto._id),
      ),
    ]);

    return dto;
  }
}

