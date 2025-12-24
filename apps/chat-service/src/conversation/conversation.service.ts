import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
import { Model } from 'mongoose';
import {
  Conversation,
  ConversationDocument,
} from 'src/mongo/schema/conversation.schema';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import { populateAndMapConversation } from 'src/utils/mapping';
import { ConversationCacheService } from './conversation-cache.service';
import { ChatStreamProducerService } from 'src/chat-stream-producer/chat-stream-producer.service';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,

    private readonly cache: ConversationCacheService,
    private readonly chatStreamProducer: ChatStreamProducerService,
  ) {}

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
    if (await this.cache.hasEmptyFlag(userId)) {
      return new CursorPageResponse([], null, false);
    }

    // 2) Thử lấy từ Redis ZSET + HASH
    const page = await this.cache.getUserConversationsPage(
      userId,
      query.cursor ?? null,
      limit,
    );

    if (page && page.items.length) {
      return new CursorPageResponse(
        plainToInstance(ConversationResponseDTO, page.items, {
          excludeExtraneousValues: true,
        }),
        page.nextCursor,
        page.hasNext,
      );
    }

    // Cache miss → DB fallback
    const dbFilter = query.cursor
      ? { updatedAt: { $lt: new Date(Number(query.cursor)) } }
      : {};
    const dbItems = await this.conversationModel
      .find({ participants: userId, ...dbFilter })
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

      await doc.save();

      const convDto = populateAndMapConversation(doc);

      await Promise.all([
        this.updateConversationCache(doc),
        this.chatStreamProducer.publishConversationCreated(convDto),
      ]);
      return convDto;
    }

    if (!dto.groupName || dto.groupName.trim().length === 0) {
      throw new BadRequestException('Group conversation must have a name');
    }

    // ----- GROUP -----
    const doc = new this.conversationModel({
      isGroup: true,
      participants,
      groupName: dto.groupName,
      groupAvatar: dto.groupAvatar,
      admins: [userId],
    });

    await doc.save();
    const convDto = populateAndMapConversation(doc);

    await Promise.all([
      this.updateConversationCache(doc),
      this.chatStreamProducer.publishConversationCreated(convDto),
    ]);
    return convDto;
  }

  // ============ UPDATE GROUP ============

  async updateConversation(
    userId: string,
    conversationId: string,
    dto: UpdateConversationDTO,
  ): Promise<ConversationResponseDTO> {
    const conv = await this.conversationModel.findById(conversationId).exec();

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

    if (dto.groupName !== undefined) conv.groupName = dto.groupName;
    if (dto.groupAvatar !== undefined) conv.groupAvatar = dto.groupAvatar;

    const toAdd = Array.isArray(dto.participantsToAdd)
      ? dto.participantsToAdd
      : [];
    const toRemove = Array.isArray(dto.participantsToRemove)
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

    await conv.save();
    await this.updateConversationCache(conv);

    const convDto = populateAndMapConversation(conv);

    // 🔥 event: conversation updated
    await this.chatStreamProducer.publishConversationUpdated(convDto);

    // 🔥 event: memberJoined
    if (toAdd.length) {
      await this.chatStreamProducer.publishConversationMemberJoined({
        conversation: convDto,
        joinedUserIds: toAdd,
      });
    }

    // 🔥 event: memberLeft
    if (toRemove.length) {
      await Promise.all([
        this.chatStreamProducer.publishConversationMemberLeft({
          conversationId,
          leftUserIds: toRemove,
        }),
        ...toRemove.map((leftUserId) =>
          this.cache.removeConversationFromUser(leftUserId, conversationId),
        ),
      ]);
    }

    return convDto;
  }

  async markConversationAsRead(
    userId: string,
    conversationId: string,
    lastMessageId?: string,
  ): Promise<string | null> {
    const conv = await this.conversationModel.findById(conversationId).exec();
    if (!conv) throw new RpcException('Conversation not found');
    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    // 1) Xác định target message
    let targetMsg: MessageDocument | null = null;

    if (lastMessageId) {
      targetMsg = await this.messageModel.findById(lastMessageId).exec();
      if (!targetMsg) throw new RpcException('Message not found');
      if (targetMsg.conversationId.toString() !== conversationId) {
        throw new RpcException('Message does not belong to this conversation');
      }
    } else {
      if (!conv.lastMessage) return null;
      targetMsg = await this.messageModel.findById(conv.lastMessage).exec();
      if (!targetMsg) return null;
    }

    const targetId = targetMsg._id.toString();

    // 2) Early return nếu trùng id (mở conversation nhiều lần)
    const prevId = conv.lastSeenMessageId?.get(userId);
    if (prevId && prevId === targetId) {
      return prevId;
    }

    // 3) Không đi lùi (so createdAt để chắc chắn)
    if (prevId) {
      const [prev, now] = await Promise.all([
        this.messageModel.findById(prevId).exec(),
        this.messageModel.findById(targetId).exec(),
      ]);

      // nếu target cũ hơn/equal prev => không update
      if (prev && now && (prev as any).createdAt >= (now as any).createdAt) {
        return prevId;
      }
    }

    // 4) Mark seenBy cho các message <= target (trừ message do mình gửi)
    const baseFilter: any = {
      conversationId: conv._id,
      _id: { $lte: targetMsg._id },
      senderId: { $ne: userId },
      seenBy: { $ne: userId },
    };

    await this.messageModel.updateMany(baseFilter, {
      $addToSet: { seenBy: userId },
    });

    // 5) Update lastSeenMessageId mà KHÔNG bump updatedAt
    // Map<string,string> trong Mongoose sẽ lưu dạng object: lastSeenMessageId: { [userId]: targetId }
    await this.conversationModel.updateOne(
      { _id: conv._id },
      { $set: { [`lastSeenMessageId.${userId}`]: targetId } },
      { timestamps: false } as any,
    );

    // 6) Update cache + broadcast (chỉ khi có thay đổi)
    await Promise.all([
      this.updateConversationCache({
        ...conv.toObject(),
        lastSeenMessageId: new Map<string, string>([
          ...(conv.lastSeenMessageId?.entries?.()
            ? (Array.from(conv.lastSeenMessageId.entries()) as [
                string,
                string,
              ][])
            : []),
          [userId, targetId],
        ]),
      } as any),
      this.chatStreamProducer.publishConversationRead({
        conversationId,
        userId,
        lastSeenMessageId: targetId,
      }),
    ]);

    return targetId;
  }

  // ============ LEAVE GROUP ============

  async leaveConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ message: string }> {
    const conv = await this.conversationModel.findById(conversationId).exec();

    if (!conv) throw new RpcException('Conversation not found');

    if (!conv.isGroup) {
      throw new RpcException('Cannot leave direct conversation');
    }

    if (!conv.participants.includes(userId)) {
      return {
        message: 'You are not in this conversation',
      }; // đã không ở trong group -> coi như ok
    }

    conv.participants = conv.participants.filter((p) => p !== userId);
    conv.admins = (conv.admins || []).filter((a) => a !== userId);
    conv.hiddenFor = (conv.hiddenFor || []).filter((u) => u !== userId);

    // Không còn ai -> xoá hẳn conv
    if (!conv.participants.length) {
      throw new RpcException('Conversation has no participants left');
    }

    // Nếu không còn admin -> promote 1 người còn lại
    if (!conv.admins.length) {
      conv.admins = [conv.participants[0]];
    }

    await conv.save();
    await Promise.all([
      this.updateConversationCache(conv),
      this.cache.removeConversationFromUser(userId, conversationId),
      this.chatStreamProducer.publishConversationMemberLeft({
        conversationId,
        leftUserIds: [userId],
      }),
    ]);
    return {
      message: 'You have left the conversation',
    };
  }

  // ============ DELETE CONVERSATION ============

  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<{
    message: string;
  }> {
    const conv = await this.conversationModel.findById(conversationId).exec();

    if (!conv) throw new RpcException('Conversation not found');

    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    // DIRECT: "delete" = hide cho riêng user
    if (!conv.isGroup) {
      return {
        message:
          'Direct conversation cannot be deleted, only hidden locally by client',
      };
    }

    // GROUP: admin mới được xóa hẳn
    if (!conv.admins?.includes(userId)) {
      throw new RpcException('You are not admin of this conversation');
    }

    await Promise.all([
      this.hardDeleteConversation(conv),
      this.chatStreamProducer.publishConversationDeleted({
        conversationId,
        participants: conv.participants,
      }),
    ]);
    return { message: 'Conversation deleted' };
  }

  // ============ HIDE / UNHIDE (APPLY CHO CẢ GROUP & DIRECT) ============

  async hideConversationForUser(
    userId: string,
    conversationId: string,
  ): Promise<{
    message: string;
  }> {
    const conv = await this.conversationModel.findById(conversationId).exec();

    if (!conv) throw new RpcException('Conversation not found');
    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    if (!conv.hiddenFor?.includes(userId)) {
      conv.hiddenFor = [...(conv.hiddenFor || []), userId];
      await conv.save();
    }

    // xoá conv này khỏi cache list của riêng user
    await this.updateConversationCache(conv);
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
    const conv = await this.conversationModel.findById(conversationId).exec();

    if (!conv) throw new RpcException('Conversation not found');
    if (!conv.participants.includes(userId)) {
      throw new RpcException('You are not in this conversation');
    }

    if (!conv.hiddenFor?.includes(userId)) {
      // vốn không hide -> thôi
      return {
        message: 'Conversation was not hidden',
      };
    }

    conv.hiddenFor = conv.hiddenFor.filter((u) => u !== userId);
    await conv.save();

    await this.updateConversationCache(conv);
    return {
      message: 'Conversation unhidden',
    };
  }

  // ============ HARD DELETE (group) ============

  private async hardDeleteConversation(conv: ConversationDocument) {
    const convId = conv._id.toString();
    const participants = conv.participants || [];

    await this.conversationModel.deleteOne({ _id: conv._id });
    await this.messageModel.deleteMany({ conversationId: conv._id });

    await this.cache.removeConversationGlobally(convId, participants);
  }

  // ============ UPDATE CACHE SAU KHI CONV THAY ĐỔI ============

  async updateConversationCache(conv: ConversationDocument) {
    const fullConv = await this.conversationModel
      .findById(conv._id)
      .populate<{ lastMessage: MessageDocument | null }>('lastMessage')
      .exec();

    if (!fullConv) return;

    const dto = populateAndMapConversation(fullConv);

    await Promise.all([
      this.cache.setConversationDetail(dto),
      ...(fullConv.participants ?? []).map((userId) =>
        this.cache.upsertConversationToUserList(userId, dto),
      ),
    ]);
  }
}
