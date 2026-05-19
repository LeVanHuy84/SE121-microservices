import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { ConfigService } from '@nestjs/config';
import {
  AcceptCallDTO,
  CallEndReason,
  CallSessionResponseDTO,
  CallSessionStatus,
  CreateCallDTO,
  DEFAULT_CALL_RECONNECT_TIMEOUT_MS,
  DEFAULT_CALL_RING_TIMEOUT_MS,
  EndCallDTO,
  JoinCallDTO,
  KickCallParticipantDTO,
  LeaveCallDTO,
  RejectCallDTO,
  SendCallSignalDTO,
} from '@repo/dtos';
import { plainToInstance } from 'class-transformer';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  CallSession,
  CallSessionDocument,
} from 'src/mongo/schema/call-session.schema';
import {
  Conversation,
  ConversationDocument,
} from 'src/mongo/schema/conversation.schema';
import { Message, MessageDocument } from 'src/mongo/schema/message.schema';
import { OutboxService } from 'src/outbox/outbox.service';
import {
  populateAndMapConversation,
  populateAndMapMessage,
} from 'src/utils/mapping';
import Redis from 'ioredis';
import { ChatPushService } from 'src/push/chat-push.service';
import { UserClientService } from 'src/client/user/user-client.service';
import { StreamMediaProvider } from './media/stream-media.provider';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);
  private readonly ringTimeoutKey = 'chat:call:ring-timeout:z';
  private readonly reconnectTimeoutKey = 'chat:call:reconnect-timeout:z';
  private readonly emptyRoomTimeoutKey = 'chat:call:empty-room-timeout:z';
  private readonly groupCallMaxParticipants: number;
  private readonly emptyRoomTimeoutMs: number;

  constructor(
    @InjectModel(CallSession.name)
    private readonly callSessionModel: Model<CallSessionDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectRedis() private readonly redis: Redis,
    private readonly outboxService: OutboxService,
    @InjectConnection() private readonly connection: Connection,
    private readonly configService: ConfigService,
    private readonly chatPushService: ChatPushService,
    private readonly userClientService: UserClientService,
    private readonly streamProvider: StreamMediaProvider,
  ) {
    this.groupCallMaxParticipants = this.getNumberConfig(
      'GROUP_CALL_MAX_PARTICIPANTS',
      10,
    );
    this.emptyRoomTimeoutMs = this.getNumberConfig(
      'GROUP_CALL_EMPTY_ROOM_TIMEOUT_MS',
      15_000,
    );
  }

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

  async getCallById(callId: string): Promise<CallSessionResponseDTO> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new RpcException('Invalid call id');
    }

    const doc = await this.callSessionModel.findById(callId).lean().exec();
    if (!doc) {
      throw new RpcException('Call session not found');
    }

    return this.toCallResponse(doc);
  }

  async createCall(
    userId: string,
    dto: CreateCallDTO,
  ): Promise<CallSessionResponseDTO> {
    const result = await this.withTransaction(async (session) => {
      const conversation = await this.conversationModel
        .findById(dto.conversationId)
        .session(session)
        .exec();

      if (!conversation) {
        throw new RpcException('Conversation not found');
      }
      if (!conversation.participants.includes(userId)) {
        throw new RpcException('You are not in this conversation');
      }

      // Check for active call in THIS conversation
      const hasActiveCallInConversation = await this.callSessionModel
        .exists({
          conversationId: conversation._id,
          status: {
            $in: [
              CallSessionStatus.INITIATED,
              CallSessionStatus.RINGING,
              CallSessionStatus.ACCEPTED,
            ],
          },
        })
        .session(session);

      if (hasActiveCallInConversation) {
        throw new RpcException('Conversation already has an active call');
      }

      // Check if recipient is busy (for 1-1 calls)
      if (!conversation.isGroup) {
        const recipientId = conversation.participants.find((id) => id !== userId);
        if (recipientId) {
          const recipientHasActiveCall = await this.callSessionModel
            .exists({
              participants: recipientId,
              status: {
                $in: [CallSessionStatus.RINGING, CallSessionStatus.ACCEPTED],
              },
            })
            .session(session);

          if (recipientHasActiveCall) {
            throw new RpcException('RECIPIENT_BUSY');
          }
        }
      }

      // Check if CALLER is already in another active call (Global check)
      const userHasActiveCall = await this.callSessionModel
        .exists({
          participants: userId,
          status: {
            $in: [
              CallSessionStatus.RINGING,
              CallSessionStatus.ACCEPTED,
            ],
          },
        })
        .session(session);

      if (userHasActiveCall) {
        throw new RpcException('USER_BUSY_IN_ANOTHER_CALL');
      }

      const now = new Date();
      const ringTimeoutAt = new Date(now.getTime() + DEFAULT_CALL_RING_TIMEOUT_MS);

      const call = new this.callSessionModel({
        conversationId: conversation._id,
        initiatorId: userId,
        participants: conversation.participants,
        isGroupCall: Boolean(conversation.isGroup),
        maxParticipants: conversation.isGroup
          ? this.groupCallMaxParticipants
          : 2,
        type: dto.type,
        status: CallSessionStatus.RINGING,
        ringTimeoutAt,
      });
      await call.save({ session });
      await this.scheduleRingTimeout(call._id.toString(), ringTimeoutAt);

      // Register the call with Stream media infra
      const moderatorUserIds = [userId, ...(conversation?.admins || [])].filter(
        (id, index, self) => self.indexOf(id) === index,
      );

      await this.streamProvider.registerCall({
        callId: call._id.toString(),
        conversationId: conversation._id.toString(),
        initiatorId: userId,
        participants: conversation.participants,
        moderatorUserIds,
      });

      conversation.activeCallId = call._id;
      conversation.lastCallAt = now;
      await conversation.save({ session });

      const callDto = this.toCallResponse(call.toObject());

      await this.outboxService.enqueueChatEvent(
        'call.created',
        callDto,
        callDto._id,
        session,
      );

      return { callDto, conversation };
    });

    // Trigger Push Notification outside transaction
    void this.triggerCallPush(userId, result.callDto, result.conversation);

    return result.callDto;
  }

  private async triggerCallPush(
    callerId: string,
    callDto: CallSessionResponseDTO,
    conversation: ConversationDocument,
  ) {
    try {
      const caller = await this.userClientService.getUserInfo(callerId);
      const callerName =
        [caller?.firstName, caller?.lastName].filter(Boolean).join(' ').trim() ||
        callerId;

      const receiverIds = conversation.participants.filter((id) => id !== callerId);

      await this.chatPushService.sendCallPush({
        conversationId: conversation._id.toString(),
        isGroup: conversation.isGroup,
        conversationName: conversation.groupName,
        callerId,
        callerName,
        callerAvatar: caller?.avatarUrl,
        callId: callDto._id,
        callType: callDto.type,
        receiverIds,
      });
    } catch (error) {
      this.logger.error(`Failed to trigger call push: ${error.message}`);
    }
  }

  async acceptCall(
    userId: string,
    dto: AcceptCallDTO,
  ): Promise<CallSessionResponseDTO> {
    return this.withTransaction(async (session) => {
      const call = await this.findAuthorizedCall(dto.callId, userId, session);

      if (call.status === CallSessionStatus.ACCEPTED) {
        return this.toCallResponse(call.toObject());
      }
      if (call.status !== CallSessionStatus.RINGING) {
        throw new RpcException('Call is not in ringing state');
      }

      const now = new Date();
      const reconnectDeadlineAt = new Date(
        now.getTime() + DEFAULT_CALL_RECONNECT_TIMEOUT_MS,
      );
      call.status = CallSessionStatus.ACCEPTED;
      call.startedAt = now;
      call.ringTimeoutAt = null;
      call.reconnectDeadlineAt = reconnectDeadlineAt;
      await call.save({ session });
      await this.clearRingTimeout(call._id.toString());
      await this.scheduleReconnectTimeout(
        call._id.toString(),
        reconnectDeadlineAt,
      );

      const conversation = await this.conversationModel
        .findById(call.conversationId)
        .session(session)
        .exec();

      if (conversation) {
        conversation.activeCallId = call._id;
        conversation.lastCallAt = now;
        await conversation.save({ session });
      }

      const callDto = this.toCallResponse(call.toObject());
      await this.outboxService.enqueueChatEvent(
        'call.accepted',
        {
          callId: callDto._id,
          conversationId: callDto.conversationId,
          userId,
          participants: call.participants,
          startedAt: now,
        },
        callDto._id,
        session,
      );

      return callDto;
    });
  }

  async rejectCall(
    userId: string,
    dto: RejectCallDTO,
  ): Promise<CallSessionResponseDTO> {
    return this.withTransaction(async (session) => {
      const call = await this.findAuthorizedCall(dto.callId, userId, session);

      if (
        call.status === CallSessionStatus.REJECTED ||
        call.status === CallSessionStatus.CANCELLED
      ) {
        return this.toCallResponse(call.toObject());
      }
      if (call.status !== CallSessionStatus.RINGING) {
        throw new RpcException('Call is not in ringing state');
      }

      const now = new Date();
      const endReason =
        dto.reason ??
        (call.initiatorId === userId
          ? CallEndReason.HANGUP
          : CallEndReason.REJECTED);

      call.status =
        call.initiatorId === userId
          ? CallSessionStatus.CANCELLED
          : CallSessionStatus.REJECTED;
      call.endReason = endReason;
      call.endedAt = now;
      call.ringTimeoutAt = null;
      call.reconnectDeadlineAt = null;
      await call.save({ session });
      await this.clearAllTimeoutSchedules(call._id.toString());
      await this.createTerminalCallMessage(call, userId, 0, session);

      await this.clearConversationActiveCall(call, session);

      await this.emitCallEndedEvent(session, call, userId, endReason, 0, now);

      // Trigger Cancel Push outside transaction if it was ringing
      const callDto = this.toCallResponse(call.toObject());
      void this.triggerCallCancelPush(userId, callDto);

      return callDto;
    });
  }

  private async triggerCallCancelPush(
    actorId: string,
    callDto: CallSessionResponseDTO,
  ) {
    try {
      const receiverIds = callDto.participants.filter((id) => id !== actorId);
      if (!receiverIds.length) return;

      await this.chatPushService.sendCallCancelPush({
        callId: callDto._id,
        conversationId: callDto.conversationId,
        actorId,
        receiverIds,
      });
    } catch (error) {
      this.logger.error(`Failed to trigger call cancel push: ${error.message}`);
    }
  }

  async endCall(userId: string, dto: EndCallDTO): Promise<CallSessionResponseDTO> {
    return this.withTransaction(async (session) => {
      const call = await this.findAuthorizedCall(dto.callId, userId, session);

      if (
        call.status === CallSessionStatus.ENDED ||
        call.status === CallSessionStatus.REJECTED ||
        call.status === CallSessionStatus.CANCELLED ||
        call.status === CallSessionStatus.MISSED
      ) {
        return this.toCallResponse(call.toObject());
      }

      if (
        call.status !== CallSessionStatus.ACCEPTED &&
        call.status !== CallSessionStatus.RINGING
      ) {
        throw new RpcException('Call cannot be ended from current state');
      }

      const now = new Date();
      const isRingingCancel = call.status === CallSessionStatus.RINGING;
      const endReason =
        dto.reason ?? (isRingingCancel ? CallEndReason.HANGUP : CallEndReason.HANGUP);
      const nextStatus = isRingingCancel
        ? CallSessionStatus.CANCELLED
        : CallSessionStatus.ENDED;

      call.status = nextStatus;
      call.endReason = endReason;
      call.endedAt = now;
      call.ringTimeoutAt = null;
      call.reconnectDeadlineAt = null;

      await call.save({ session });
      await this.clearAllTimeoutSchedules(call._id.toString());

      const durationSec =
        call.startedAt && call.endedAt
          ? Math.max(
              0,
              Math.floor(
                (call.endedAt.getTime() - call.startedAt.getTime()) / 1000,
              ),
            )
          : 0;

      await this.createTerminalCallMessage(call, userId, durationSec, session);

      await this.clearConversationActiveCall(call, session);

      await this.emitCallEndedEvent(
        session,
        call,
        userId,
        endReason,
        durationSec,
        now,
      );

      const callDto = this.toCallResponse(call.toObject());
      if (isRingingCancel) {
        void this.triggerCallCancelPush(userId, callDto);
      }

      return callDto;
    });
  }

  async sendCallSignal(userId: string, dto: SendCallSignalDTO) {
    const call = await this.findAuthorizedCall(dto.callId, userId);
    if (call.status !== CallSessionStatus.RINGING && call.status !== CallSessionStatus.ACCEPTED) {
      throw new RpcException('Call is not active');
    }
    if (!call.participants.includes(dto.targetUserId)) {
      throw new RpcException('Target user is not in this call');
    }

    const payload = {
      callId: dto.callId,
      fromUserId: userId,
      targetUserId: dto.targetUserId,
      signalType: dto.signalType,
      sdp: dto.sdp,
      candidate: dto.candidate,
      sdpMid: dto.sdpMid,
      sdpMLineIndex: dto.sdpMLineIndex,
      conversationId: call.conversationId.toString(),
    };

    if (call.status === CallSessionStatus.ACCEPTED) {
      const reconnectDeadlineAt = new Date(
        Date.now() + DEFAULT_CALL_RECONNECT_TIMEOUT_MS,
      );
      await this.callSessionModel.updateOne(
        { _id: call._id, status: CallSessionStatus.ACCEPTED },
        { $set: { reconnectDeadlineAt } },
      );
      await this.scheduleReconnectTimeout(call._id.toString(), reconnectDeadlineAt);
    }

    await this.outboxService.enqueueChatEvent('call.signal', payload, dto.callId);

    return payload;
  }

  async joinCall(userId: string, dto: JoinCallDTO) {
    const call = await this.findAuthorizedCall(dto.callId, userId);
    if (call.status !== CallSessionStatus.ACCEPTED) {
      throw new RpcException('Call is not joinable');
    }

    if (call.isGroupCall) {
      const onlineCount = await this.redis.scard(this.groupOnlineSetKey(call._id.toString()));
      const limit = call.maxParticipants ?? this.groupCallMaxParticipants;
      if (onlineCount >= limit) {
        throw new RpcException('CALL_ROOM_FULL');
      }
    }

    await this.redis.sadd(this.groupOnlineSetKey(call._id.toString()), userId);
    await this.redis.expire(this.groupOnlineSetKey(call._id.toString()), 86_400);
    await this.clearEmptyRoomTimeout(call._id.toString());

    const payload = {
      callId: call._id.toString(),
      conversationId: call.conversationId.toString(),
      userId,
      participants: call.participants,
    };
    await this.outboxService.enqueueChatEvent(
      'call.participantJoined',
      payload,
      call._id.toString(),
    );
    return payload;
  }

  async leaveCall(userId: string, dto: LeaveCallDTO) {
    const call = await this.findAuthorizedCall(dto.callId, userId);
    if (call.status !== CallSessionStatus.ACCEPTED) {
      throw new RpcException('Call is not active');
    }

    await this.redis.srem(this.groupOnlineSetKey(call._id.toString()), userId);
    const remaining = await this.redis.scard(this.groupOnlineSetKey(call._id.toString()));
    if (remaining === 0) {
      await this.scheduleEmptyRoomTimeout(
        call._id.toString(),
        new Date(Date.now() + this.emptyRoomTimeoutMs),
      );
    }

    const payload = {
      callId: call._id.toString(),
      conversationId: call.conversationId.toString(),
      userId,
      participants: call.participants,
      remainingParticipants: remaining,
    };
    await this.outboxService.enqueueChatEvent(
      'call.participantLeft',
      payload,
      call._id.toString(),
    );
    return payload;
  }

  async kickCallParticipant(userId: string, dto: KickCallParticipantDTO) {
    const call = await this.findAuthorizedCall(dto.callId, userId);
    if (!call.isGroupCall) {
      throw new RpcException('Kick is only allowed in group call');
    }

    const conversation = await this.conversationModel
      .findById(call.conversationId)
      .exec();

    const isInitiator = call.initiatorId === userId;
    const isAdmin = conversation?.admins?.includes(userId);

    if (!isInitiator && !isAdmin) {
      throw new RpcException(
        'Only call initiator or group admins can kick participant',
      );
    }
    if (!call.participants.includes(dto.targetUserId)) {
      throw new RpcException('Target user is not in this call');
    }

    await this.redis.srem(
      this.groupOnlineSetKey(call._id.toString()),
      dto.targetUserId,
    );
    const remaining = await this.redis.scard(this.groupOnlineSetKey(call._id.toString()));
    if (remaining === 0) {
      await this.scheduleEmptyRoomTimeout(
        call._id.toString(),
        new Date(Date.now() + this.emptyRoomTimeoutMs),
      );
    }

    const payload = {
      callId: call._id.toString(),
      conversationId: call.conversationId.toString(),
      userId,
      targetUserId: dto.targetUserId,
      participants: call.participants,
      remainingParticipants: remaining,
    };
    await this.outboxService.enqueueChatEvent(
      'call.participantKicked',
      payload,
      call._id.toString(),
    );
    return payload;
  }

  async getAuthorizedCallForUser(callId: string, userId: string) {
    const call = await this.findAuthorizedCall(callId, userId);
    return call.toObject();
  }

  async markMissedCallBySystem(callId: string): Promise<boolean> {
    try {
      await this.withTransaction(async (session) => {
        if (!Types.ObjectId.isValid(callId)) return;
        const call = await this.callSessionModel
          .findById(callId)
          .session(session)
          .exec();
        if (!call) return;
        if (call.status !== CallSessionStatus.RINGING) return;

        const now = new Date();
        if (!call.ringTimeoutAt || call.ringTimeoutAt.getTime() > now.getTime()) {
          return;
        }

        call.status = CallSessionStatus.MISSED;
        call.endReason = CallEndReason.MISSED;
        call.endedAt = now;
        call.ringTimeoutAt = null;
        call.reconnectDeadlineAt = null;
        await call.save({ session });
        await this.clearAllTimeoutSchedules(call._id.toString());

        await this.createTerminalCallMessage(call, call.initiatorId, 0, session);
        await this.clearConversationActiveCall(call, session);

        await this.emitCallEndedEvent(
          session,
          call,
          call.initiatorId,
          CallEndReason.MISSED,
          0,
          now,
        );
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `markMissedCallBySystem failed callId=${callId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async markReconnectTimeoutCallBySystem(callId: string): Promise<boolean> {
    try {
      await this.withTransaction(async (session) => {
        if (!Types.ObjectId.isValid(callId)) return;
        const call = await this.callSessionModel
          .findById(callId)
          .session(session)
          .exec();
        if (!call) return;
        if (call.status !== CallSessionStatus.ACCEPTED) return;

        const now = new Date();
        if (
          !call.reconnectDeadlineAt ||
          call.reconnectDeadlineAt.getTime() > now.getTime()
        ) {
          return;
        }

        call.status = CallSessionStatus.ENDED;
        call.endReason = CallEndReason.TIMEOUT;
        call.endedAt = now;
        call.ringTimeoutAt = null;
        call.reconnectDeadlineAt = null;
        await call.save({ session });
        await this.clearAllTimeoutSchedules(call._id.toString());

        const durationSec =
          call.startedAt && call.endedAt
            ? Math.max(
                0,
                Math.floor(
                  (call.endedAt.getTime() - call.startedAt.getTime()) / 1000,
                ),
              )
            : 0;

        await this.createTerminalCallMessage(
          call,
          call.initiatorId,
          durationSec,
          session,
        );
        await this.clearConversationActiveCall(call, session);

        await this.emitCallEndedEvent(
          session,
          call,
          call.initiatorId,
          CallEndReason.TIMEOUT,
          durationSec,
          now,
        );
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `markReconnectTimeoutCallBySystem failed callId=${callId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  async markEmptyRoomTimeoutCallBySystem(callId: string): Promise<boolean> {
    try {
      await this.withTransaction(async (session) => {
        if (!Types.ObjectId.isValid(callId)) return;
        const call = await this.callSessionModel
          .findById(callId)
          .session(session)
          .exec();
        if (!call) return;
        if (call.status !== CallSessionStatus.ACCEPTED) return;
        if (!call.isGroupCall) return;

        const onlineCount = await this.redis.scard(
          this.groupOnlineSetKey(call._id.toString()),
        );
        if (onlineCount > 0) return;

        const now = new Date();
        call.status = CallSessionStatus.ENDED;
        call.endReason = CallEndReason.TIMEOUT;
        call.endedAt = now;
        call.ringTimeoutAt = null;
        call.reconnectDeadlineAt = null;
        await call.save({ session });
        await this.clearAllTimeoutSchedules(call._id.toString());
        await this.clearEmptyRoomTimeout(call._id.toString());

        const durationSec =
          call.startedAt && call.endedAt
            ? Math.max(
                0,
                Math.floor(
                  (call.endedAt.getTime() - call.startedAt.getTime()) / 1000,
                ),
              )
            : 0;

        await this.createTerminalCallMessage(
          call,
          call.initiatorId,
          durationSec,
          session,
        );
        await this.clearConversationActiveCall(call, session);
        await this.emitCallEndedEvent(
          session,
          call,
          call.initiatorId,
          CallEndReason.TIMEOUT,
          durationSec,
          now,
        );
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `markEmptyRoomTimeoutCallBySystem failed callId=${callId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private async findAuthorizedCall(
    callId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<CallSessionDocument> {
    if (!Types.ObjectId.isValid(callId)) {
      throw new RpcException('Invalid call id');
    }

    const query = this.callSessionModel.findById(callId);
    if (session) query.session(session);
    const call = await query.exec();

    if (!call) {
      throw new RpcException('Call session not found');
    }
    if (!call.participants.includes(userId)) {
      throw new RpcException('You are not in this call');
    }

    return call;
  }

  private async createTerminalCallMessage(
    call: CallSessionDocument,
    actorId: string,
    durationSec: number,
    session: ClientSession,
  ) {
    if (call.callMessageId) {
      return;
    }

    const msg = await new this.messageModel({
      conversationId: call.conversationId,
      senderId: actorId,
      content: this.buildSystemCallContent(call.type, call.status),
      messageType: 'system_call',
      systemMeta: {
        kind: 'call' as const,
        callId: call._id.toString(),
        callType: call.type,
        callStatus: call.status,
        endedReason: call.endReason,
        durationSec,
        actorId,
      },
      seenBy: [actorId],
      status: 'sent',
    }).save({ session });

    call.callMessageId = msg._id;
    await call.save({ session });

    const dtoMsg = populateAndMapMessage(msg);
    if (!dtoMsg) {
      throw new RpcException('Failed to map call message');
    }
    await this.outboxService.enqueueChatEvent(
      'message.created',
      dtoMsg,
      call.conversationId.toString(),
      session,
    );

    const conv = await this.conversationModel
      .findById(call.conversationId)
      .session(session)
      .exec();
    if (!conv) return;

    conv.lastMessage = msg._id;
    await conv.save({ session });

    const convDto = populateAndMapConversation({
      ...conv.toObject(),
      lastMessage: msg.toObject(),
    });
    await this.outboxService.enqueueChatEvent(
      'conversation.updated',
      convDto,
      conv._id.toString(),
      session,
    );

    // Trigger Push for terminal message (e.g., Missed Call)
    void this.chatPushService.sendMessagePush({
      conversationId: conv._id.toString(),
      isGroup: conv.isGroup,
      conversationName: conv.groupName,
      senderId: actorId,
      messageId: msg._id.toString(),
      preview: this.buildSystemCallContent(call.type, call.status),
      receiverIds: call.participants.filter((id) => id !== actorId),
    });
  }

  private async clearConversationActiveCall(
    call: CallSessionDocument,
    session: ClientSession,
  ) {
    const conv = await this.conversationModel
      .findById(call.conversationId)
      .session(session)
      .exec();
    if (!conv) return;

    if (
      conv.activeCallId &&
      conv.activeCallId.toString() === call._id.toString()
    ) {
      conv.activeCallId = null;
    }
    conv.lastCallAt = new Date();
    await conv.save({ session });

    const convDto = populateAndMapConversation(conv);
    await this.outboxService.enqueueChatEvent(
      'conversation.updated',
      convDto,
      conv._id.toString(),
      session,
    );
  }

  private buildSystemCallContent(
    type: 'audio' | 'video',
    status: CallSessionStatus,
  ): string {
    const callLabel = type === 'video' ? 'cuộc gọi video' : 'cuộc gọi thoại';
    switch (status) {
      case CallSessionStatus.RINGING:
        return `Đã bắt đầu ${callLabel}`;
      case CallSessionStatus.ACCEPTED:
        return `${callLabel} đã được chấp nhận`;
      case CallSessionStatus.REJECTED:
        return `${callLabel} đã bị từ chối`;
      case CallSessionStatus.MISSED:
        return `${callLabel} nhỡ`;
      case CallSessionStatus.CANCELLED:
        return `${callLabel} đã bị hủy`;
      case CallSessionStatus.ENDED:
        return `${callLabel} đã kết thúc`;
      case CallSessionStatus.INITIATED:
      default:
        return `Đang khởi tạo ${callLabel}`;
    }
  }

  private toCallResponse(call: any): CallSessionResponseDTO {
    return plainToInstance(CallSessionResponseDTO, {
      ...call,
      _id: call._id?.toString?.() ?? call._id,
      conversationId:
        call.conversationId?.toString?.() ?? call.conversationId,
      callMessageId: call.callMessageId?.toString?.() ?? call.callMessageId,
    });
  }

  private async clearAllTimeoutSchedules(callId: string) {
    await Promise.all([
      this.clearRingTimeout(callId),
      this.clearReconnectTimeout(callId),
      this.clearEmptyRoomTimeout(callId),
    ]);
  }

  private async emitCallEndedEvent(
    session: ClientSession,
    call: CallSessionDocument,
    actorId: string,
    reason: CallEndReason,
    durationSec: number,
    endedAt = new Date(),
  ) {
    const callDto = this.toCallResponse(call.toObject());
    await this.outboxService.enqueueChatEvent(
      'call.ended',
      {
        callId: callDto._id,
        conversationId: callDto.conversationId,
        userId: actorId,
        participants: call.participants,
        reason,
        status: callDto.status,
        endedAt,
        durationSec,
      },
      callDto._id,
      session,
    );
  }

  async popDueRingTimeoutCallIds(limit: number): Promise<string[]> {
    return this.popDueTimeoutCallIds(this.ringTimeoutKey, limit);
  }

  async popDueReconnectTimeoutCallIds(limit: number): Promise<string[]> {
    return this.popDueTimeoutCallIds(this.reconnectTimeoutKey, limit);
  }

  async popDueEmptyRoomTimeoutCallIds(limit: number): Promise<string[]> {
    return this.popDueTimeoutCallIds(this.emptyRoomTimeoutKey, limit);
  }

  private async popDueTimeoutCallIds(key: string, limit: number): Promise<string[]> {
    const now = Date.now();
    const script = `
      local zkey = KEYS[1]
      local nowScore = tonumber(ARGV[1])
      local maxItems = tonumber(ARGV[2])
      local ids = redis.call('ZRANGEBYSCORE', zkey, '-inf', nowScore, 'LIMIT', 0, maxItems)
      if #ids == 0 then
        return ids
      end
      redis.call('ZREM', zkey, unpack(ids))
      return ids
    `;

    const result = (await this.redis.eval(
      script,
      1,
      key,
      String(now),
      String(limit),
    )) as string[] | null;

    return result ?? [];
  }

  private async scheduleRingTimeout(callId: string, deadline: Date) {
    await this.redis.zadd(this.ringTimeoutKey, deadline.getTime(), callId);
  }

  async scheduleRingTimeoutBulk(
    items: Array<{ callId: string; deadline: Date }>,
  ) {
    if (!items.length) return;
    const args: Array<string | number> = [];
    for (const item of items) {
      args.push(item.deadline.getTime(), item.callId);
    }
    await this.redis.zadd(this.ringTimeoutKey, ...args);
  }

  private async clearRingTimeout(callId: string) {
    await this.redis.zrem(this.ringTimeoutKey, callId);
  }

  private async scheduleReconnectTimeout(callId: string, deadline: Date) {
    await this.redis.zadd(this.reconnectTimeoutKey, deadline.getTime(), callId);
  }

  private async scheduleEmptyRoomTimeout(callId: string, deadline: Date) {
    await this.redis.zadd(this.emptyRoomTimeoutKey, deadline.getTime(), callId);
  }

  async scheduleReconnectTimeoutBulk(
    items: Array<{ callId: string; deadline: Date }>,
  ) {
    if (!items.length) return;
    const args: Array<string | number> = [];
    for (const item of items) {
      args.push(item.deadline.getTime(), item.callId);
    }
    await this.redis.zadd(this.reconnectTimeoutKey, ...args);
  }

  async scheduleEmptyRoomTimeoutBulk(
    items: Array<{ callId: string; deadline: Date }>,
  ) {
    if (!items.length) return;
    const args: Array<string | number> = [];
    for (const item of items) {
      args.push(item.deadline.getTime(), item.callId);
    }
    await this.redis.zadd(this.emptyRoomTimeoutKey, ...args);
  }

  private async clearReconnectTimeout(callId: string) {
    await this.redis.zrem(this.reconnectTimeoutKey, callId);
  }

  private async clearEmptyRoomTimeout(callId: string) {
    await this.redis.zrem(this.emptyRoomTimeoutKey, callId);
  }

  private groupOnlineSetKey(callId: string) {
    return `chat:call:${callId}:online`;
  }

  private getNumberConfig(key: string, fallback: number): number {
    const raw = this.configService.get<string | number>(key);
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }

}
