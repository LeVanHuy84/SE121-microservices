import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { ConversationResponseDTO, MessageResponseDTO } from '@repo/dtos';
import Redis from 'ioredis';

@Injectable()
export class ChatStreamProducerService {
  private readonly logger = new Logger(ChatStreamProducerService.name);
  private readonly streamKey = 'chat:events';

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ===================== MESSAGE EVENTS =====================

  async publishMessageCreated(msg: MessageResponseDTO) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'message.created',
      'payload',
      JSON.stringify(msg),
    );
    this.logger.debug(`Published message.created for messageId=${msg._id}`);
  }

  async publishMessageDeleted(msg: MessageResponseDTO) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'message.deleted',
      'payload',
      JSON.stringify(msg),
    );
    this.logger.debug(`Published message.deleted for messageId=${msg._id}`);
  }

  // ===================== CONVERSATION EVENTS =====================

  async publishConversationCreated(conv: ConversationResponseDTO) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.created',
      'payload',
      JSON.stringify(conv),
    );
    this.logger.debug(`Published conversation.created for conversationId=${conv._id}`);
  }

  async publishConversationUpdated(conv: ConversationResponseDTO) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.updated',
      'payload',
      JSON.stringify(conv),
    );
    this.logger.debug(`Published conversation.updated for conversationId=${conv._id}`);
  }

  // Member joined: 1 user mới vào group
  async publishConversationMemberJoined(data: {
    conversation: ConversationResponseDTO;
    joinedUserIds: string[];
  }) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.memberJoined',
      'payload',
      JSON.stringify(data),
    );
    this.logger.debug(`Published conversation.memberJoined for conversationId=${data.conversation._id}, joinedUserIds=${data.joinedUserIds.join(',')}`);
  }

  // Member left: 1 user rời group / bị kick
  async publishConversationMemberLeft(data: {
    conversationId: string;
    leftUserIds: string[];

  }) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.memberLeft',
      'payload',
      JSON.stringify(data),
    );
    this.logger.debug(`Published conversation.memberLeft for conversationId=${data.conversationId}, leftUserIds=${data.leftUserIds.join(',')}`);
  }

  // Xoá hẳn 1 conversation (thường là group)
  async publishConversationDeleted(data: {
    conversationId: string;
    participants: string[];
  }) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.deleted',
      'payload',
      JSON.stringify(data),
    );
    this.logger.debug(`Published conversation.deleted for conversationId=${data.conversationId}`);
  }

  async publishConversationRead(data: {
    conversationId: string;
    userId: string;
    lastSeenMessageId: string | null;
  }) {
    await this.redis.xadd(
      this.streamKey,
      '*',
      'event',
      'conversation.read',
      'payload',
      JSON.stringify(data),
    );
    this.logger.debug(`Published conversation.read for conversationId=${data.conversationId}, userId=${data.userId}`);
  }
}
