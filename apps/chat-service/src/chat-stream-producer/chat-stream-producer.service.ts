import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { ConversationResponseDTO, MessageResponseDTO } from '@repo/dtos';
import Redis from 'ioredis';

@Injectable()
export class ChatStreamProducerService {
  private readonly logger = new Logger(ChatStreamProducerService.name);
  private readonly streamKey = 'chat:events';
  private readonly streamMaxLen = 10000;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  async publishEvent(eventType: string, payload: object) {
    await this.redis.xadd(
      this.streamKey,
      'MAXLEN',
      '~',
      this.streamMaxLen,
      '*',
      'event',
      eventType,
      'payload',
      JSON.stringify(payload),
    );

    this.logger.debug(`Published ${eventType}`);
  }

  // ===================== MESSAGE EVENTS =====================

  async publishMessageCreated(msg: MessageResponseDTO) {
    await this.publishEvent('message.created', msg);
    this.logger.debug(`Published message.created for messageId=${msg._id}`);
  }

  async publishMessageDeleted(msg: MessageResponseDTO) {
    await this.publishEvent('message.deleted', msg);
    this.logger.debug(`Published message.deleted for messageId=${msg._id}`);
  }

  // ===================== CONVERSATION EVENTS =====================

  async publishConversationCreated(conv: ConversationResponseDTO) {
    await this.publishEvent('conversation.created', conv);
    this.logger.debug(
      `Published conversation.created for conversationId=${conv._id}`,
    );
  }

  async publishConversationUpdated(conv: ConversationResponseDTO) {
    await this.publishEvent('conversation.updated', conv);
    this.logger.debug(
      `Published conversation.updated for conversationId=${conv._id}`,
    );
  }

  // Member joined: 1 user mới vào group
  async publishConversationMemberJoined(data: {
    conversation: ConversationResponseDTO;
    joinedUserIds: string[];
  }) {
    await this.publishEvent('conversation.memberJoined', data);
    this.logger.debug(
      `Published conversation.memberJoined for conversationId=${data.conversation._id}, joinedUserIds=${data.joinedUserIds.join(',')}`,
    );
  }

  // Member left: 1 user rời group / bị kick
  async publishConversationMemberLeft(data: {
    conversationId: string;
    leftUserIds: string[];
  }) {
    await this.publishEvent('conversation.memberLeft', data);
    this.logger.debug(
      `Published conversation.memberLeft for conversationId=${data.conversationId}, leftUserIds=${data.leftUserIds.join(',')}`,
    );
  }

  // Xoá hẳn 1 conversation (thường là group)
  async publishConversationDeleted(data: {
    conversationId: string;
    participants: string[];
  }) {
    await this.publishEvent('conversation.deleted', data);
    this.logger.debug(
      `Published conversation.deleted for conversationId=${data.conversationId}`,
    );
  }

  async publishConversationRead(data: {
    conversationId: string;
    userId: string;
    lastSeenMessageId: string | null;
  }) {
    await this.publishEvent('conversation.read', data);
    this.logger.debug(
      `Published conversation.read for conversationId=${data.conversationId}, userId=${data.userId}`,
    );
  }

  async publishConversationHidden(data: {
    conversationId: string;
    userId: string;
  }) {
    await this.publishEvent('conversation.hidden', data);
    this.logger.debug(
      `Published conversation.hidden for conversationId=${data.conversationId}, userId=${data.userId}`,
    );
  }

  async publishConversationUnhidden(data: {
    userId: string;
    conversation: ConversationResponseDTO;
  }) {
    await this.publishEvent('conversation.unhidden', data);
    this.logger.debug(
      `Published conversation.unhidden for conversationId=${data.conversation._id}, userId=${data.userId}`,
    );
  }
}
