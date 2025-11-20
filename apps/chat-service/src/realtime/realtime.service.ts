import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RedisPubSubService } from '@repo/common';
import { SendMessageDTO } from '@repo/dtos';
import * as kafkajs from 'kafkajs';
import { Model } from 'mongoose';
import { KAFKA } from 'src/kafka/kafka.module';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);

  private readonly TOPIC_MESSAGES =
    process.env.KAFKA_TOPIC_MESSAGES || 'chat_gateway.messages';
  private readonly TOPIC_CONV_CREATE =
    process.env.KAFKA_TOPIC_CONV_CREATE || 'chat_gateway.conversation.create';
  private readonly TOPIC_MESSAGE_DELETE =
    process.env.KAFKA_TOPIC_MESSAGE_DELETE || 'chat_gateway.message.delete';

  private readonly MAX_GROUP_SIZE = 100;

  constructor(
    @Inject('REDIS_CHAT') private readonly redis: RedisPubSubService,
    @Inject(KAFKA.PRODUCER) private readonly producer: kafkajs.Producer,
    @InjectModel(Conversation.name)
    private readonly convModel: Model<Conversation>,
  ) {}

  async onModuleInit() {
    await Promise.all([
      this.redis.subscribe('chat_gateway:create_conversation', (msg) =>
        this.createConversation(msg),
      ),
      this.redis.subscribe('chat_gateway:send_message', (msg) =>
        this.sendMessage(msg),
      ),
      this.redis.subscribe('chat_gateway:delete_message', (msg) =>
        this.deleteMessage(msg),
      ),
    ]);
    this.logger.log('✅ RealtimeService initialized');
  }
  async onModuleDestroy() {
    await Promise.all([
      this.redis.unsubscribe('chat_gateway:create_conversation'),
      this.redis.unsubscribe('chat_gateway:send_message'),
      this.redis.unsubscribe('chat_gateway:delete_message'),
    ]);
    this.logger.log('🛑 RealtimeService destroyed');
  }

  /** Hàm tiện ích để publish lỗi ra Redis */
  private async publishError(
    userId: string,
    code: string,
    data: Record<string, any>,
  ) {
    await this.redis.publish(
      'chat:error',
      JSON.stringify({ userId, code, data, ts: Date.now() }),
    );
  }

  async getParticipants(conversationId: string): Promise<string[]> {
    const conv = await this.convModel
      .findById(conversationId)
      .select('participants')
      .lean();
    if (!conv) throw new Error('conversation_not_found');
    return conv.participants ?? [];
  }

  async isParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const participants = await this.getParticipants(conversationId);
    return participants.includes(userId);
  }

  async sendMessage(msg: any) {
    try {
      const { senderId, dto } = JSON.parse(msg) as {
        senderId: string;
        dto: SendMessageDTO;
      };
      const ok = await this.isParticipant(dto.conversationId, senderId);
      if (!ok) {
        await this.publishError(senderId, 'send_message_unauthorized', {
          conversationId: dto.conversationId,
        });
        return;
      }

      const messageId = `${Date.now()}-${uuidv4()}`;
      const now = Date.now();
      const envelope = {
        messageId,
        conversationId: dto.conversationId,
        senderId,
        content: dto.content ?? '',
        attachments: dto.attachments ?? [],
        replyTo: dto.replyTo ?? null,
        timestamp: now,
      };

      await this.producer.send({
        topic: this.TOPIC_MESSAGES,
        messages: [
          { key: envelope.conversationId, value: JSON.stringify(envelope) },
        ],
        acks: -1,
      });
      this.logger.debug(
        `Produced message ${messageId} to topic ${this.TOPIC_MESSAGES}`,
      );
    } catch (error) {
      throw error;
    }
  }

  async deleteMessage(msg: any) {
    try {
      const { deleterId, messageId, conversationId } = JSON.parse(msg);

      // Check participant
      const isMember = await this.isParticipant(conversationId, deleterId);
      if (!isMember) {
        await this.publishError(deleterId, 'delete_message_unauthorized', {
          deleterId,
          messageId,
          conversationId,
        });
        return;
      }

      const payload = {
        conversationId,
        messageId,
        deletedBy: deleterId,
        timestamp: Date.now(),
      };

      await this.producer.send({
        topic: this.TOPIC_MESSAGE_DELETE,
        messages: [{ key: conversationId, value: JSON.stringify(payload) }],
        acks: -1,
      });

      this.logger.debug(
        `Produced delete message ${messageId} to topic ${this.TOPIC_MESSAGE_DELETE}`,
      );
    } catch (error) {
      throw error;
    }
  }

  async createConversation(msg: any) {
    try {
      const { creatorId: createdBy, dto } = JSON.parse(msg);
      let participants = [...new Set([...(dto.participants || []), createdBy])]
        .filter((p) => p && p.trim() !== '')
        .sort();
      if (participants.length < 2) {
        await this.publishError(
          createdBy,
          'create_conversation_invalid_participants',
          {
            creatorId: createdBy,
            participants: dto.participants,
          },
        );
        return;
      }

      const isGroup = participants.length > 2;
      if (isGroup) {
        if (!dto.groupName) throw new Error('group_name_required');
        if (participants.length > this.MAX_GROUP_SIZE)
          throw new Error('group_size_exceeded');
      } else {
        const existing = await this.convModel
          .findOne({ isGroup: false, participants })
          .lean();
        if (existing)
          this.logger.debug(
            `Conversation between ${participants.join(', ')} already exists: ${existing._id}`,
          );
      }

      const payload = {
        isGroup,
        participants,
        groupName: isGroup ? dto.groupName : undefined,
        groupAvatar: isGroup ? dto.groupAvatar : undefined,
        admins: isGroup ? [createdBy] : [],
        createdBy,
        timestamp: Date.now(),
      };

      await this.producer.send({
        topic: this.TOPIC_CONV_CREATE,
        messages: [
          { key: participants.join(','), value: JSON.stringify(payload) },
        ],
        acks: -1,
      });
      this.logger.debug(
        `Produced conversation create request to topic ${this.TOPIC_CONV_CREATE}`,
      );
    } catch (error) {
      throw error;
    }
  }
}
