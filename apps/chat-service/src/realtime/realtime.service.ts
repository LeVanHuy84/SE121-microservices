import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RedisPubSubService } from '@repo/common';
import { CreateConversationDTO, SendMessageDTO } from '@repo/dtos';
import * as kafkajs from 'kafkajs';
import { Model } from 'mongoose';
import { KAFKA } from 'src/kafka/kafka.module';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);


  private readonly TOPIC_MESSAGES =
    process.env.KAFKA_TOPIC_MESSAGES || 'chat_gateway.messages';
  private readonly TOPIC_CONV_CREATE =
    process.env.KAFKA_TOPIC_CONV_CREATE || 'chat_gateway.conversation.create';


  private readonly MAX_GROUP_SIZE = 100;



  constructor(
    @Inject('REDIS_CHAT') private readonly redis: RedisPubSubService,
    @Inject(KAFKA.PRODUCER) private readonly producer: kafkajs.Producer,
    @InjectModel(Conversation.name)
    private readonly convModel: Model<Conversation>,
  ) {}

  async getParticipants(conversationId: string): Promise<string[]> {
    const cacheKey = `conv:${conversationId}:participants`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const conv = await this.convModel
      .findById(conversationId)
      .select('participants')
      .lean();
    if (!conv) throw new Error('conversation_not_found');
    const participants = conv ? conv.participants : [];
    if (participants.length) {
      await this.redis.set(cacheKey, JSON.stringify(participants), 3600); // TTL 1h
    }
    return participants;
  }

  async isParticipant(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const participants = await this.getParticipants(conversationId);
    return participants.includes(userId);
  }

  async sendMessage(senderId: string, dto: SendMessageDTO) {
    const ok = await this.isParticipant(dto.conversationId, senderId);
    if (!ok) throw new Error('not_member');

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

    const participants = await this.getParticipants(dto.conversationId);
    const byServer = new Map<string, string[]>();
    for (const uid of participants) {
      if (uid === senderId) continue;
      const serverId = await this.redis.hget(`presence:user:${uid}`, 'server');
      if (serverId) {
        const arr = byServer.get(serverId) ?? [];
        arr.push(uid);
        byServer.set(serverId, arr);
        this.logger.debug(
          `Queued message ${messageId} for user ${uid} on server ${serverId}`,
        );
      } else {
        await this.redis.publish(
          'notifications.in',
          JSON.stringify({ userId: uid, message: envelope }),
        );
        this.logger.debug(
          `Published message ${messageId} for offline user ${uid} to notifications.in`,
        );
      }
    }

    for (const [srv, uids] of byServer.entries()) {
      const payload = JSON.stringify({ toUserIds: uids, message: envelope });
      await this.redis.baseClient.xadd(
        'server.inbox',
        '*',
        'type',
        'deliver_batch',
        'serverId',
        srv,
        'payload',
        payload,
      );
    }

    return { messageId, status: 'QUEUED', timestamp: now };
  }
  async createConversation(
    createdBy: string,
    dto: CreateConversationDTO
  ) {
    let participants = [...new Set([...(dto.participants || []), createdBy])]
      .filter((p) => p && p.trim() !== '') // loại bỏ rỗng
      .sort();
    if (participants.length < 2) throw new Error('invalid_participants');

    const isGroup = participants.length > 2;
    if (isGroup) {
      if (!dto.groupName) throw new Error('group_name_required');
      if (participants.length > this.MAX_GROUP_SIZE)
        throw new Error('group_size_exceeded');
    } else {
      const existing = await this.convModel
        .findOne({ isGroup: false, participants })
        .lean();
      if (existing) return {
        status: 'EXISTS',
      }// reuse 1-1
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
    return { status: 'QUEUED' };
  }
}
