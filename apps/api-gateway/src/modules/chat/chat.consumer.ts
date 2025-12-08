// apps/api-gateway/src/chat/chat-stream.consumer.ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ConversationResponseDTO, MessageResponseDTO } from '@repo/dtos';
import { ChatGateway } from './chat.gateway';

@Injectable()
export class ChatStreamConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatStreamConsumer.name);
  private readonly streamKey = 'chat:events';

  private running = false;
  private readonly groupName = 'chat-gateway';
  private readonly consumerName: string;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly chatGateway: ChatGateway
  ) {
    const instanceId =
      process.env.GATEWAY_INSTANCE_ID ||
      process.env.HOSTNAME ||
      `${process.pid}`;
    this.consumerName = `consumer-${instanceId}`;
  }

  async onModuleInit() {
    await this.ensureGroup();
    this.running = true;

    // 1) Replay pending (message đã đọc nhưng chưa ack do crash)
    this.replayPending().catch((e) =>
      this.logger.error('Error in replayPending', e)
    );

    // 2) Bắt đầu loop đọc message mới
    this.consumeLoop();
    this.logger.log(
      `ChatStreamConsumer started group=${this.groupName}, consumer=${this.consumerName}`
    );
  }

  async onModuleDestroy() {
    this.running = false;
  }

  private async ensureGroup() {
    try {
      await this.redis.xgroup(
        'CREATE',
        this.streamKey,
        this.groupName,
        '$',
        'MKSTREAM'
      );
      this.logger.log(`Created stream group ${this.groupName}`);
    } catch (e: any) {
      if (e?.message?.includes('BUSYGROUP')) {
        this.logger.log(`Group ${this.groupName} already exists`);
      } else {
        this.logger.error('Error creating group', e);
      }
    }
  }

  /**
   * Đọc lại các message đang PENDING của consumer này (nếu có)
   * để không bị mất event khi gateway crash giữa chừng.
   */
  private async replayPending() {
    this.logger.log('Replaying pending chat events (if any)...');
    while (true) {
      const res = await this.redis.xreadgroup(
        'GROUP',
        this.groupName,
        this.consumerName,
        'COUNT',
        50,
        'STREAMS',
        this.streamKey,
        '0' // đọc từ pending list
      );

      if (!res) break;

      let processedAny = false;

      for (const [, entries] of res as any) {
        for (const [id, fields] of entries as any) {
          processedAny = true;
          await this.processEntry(id, fields);
        }
      }

      if (!processedAny) break;
    }
    this.logger.log('Replay pending done.');
  }

  private async consumeLoop() {
    while (this.running) {
      try {
        const res = await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'COUNT',
          50,
          'BLOCK',
          5000,
          'STREAMS',
          this.streamKey,
          '>' // chỉ message mới
        );

        if (!res) continue;

        for (const [, entries] of res as any) {
          for (const [id, fields] of entries as any) {
            await this.processEntry(id, fields);
          }
        }
      } catch (e) {
        this.logger.error('Error in chat messages consumeLoop', e);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processEntry(id: string, fields: string[]) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      obj[fields[i]] = fields[i + 1];
    }

    const event = obj.event;
    const payload = obj.payload;

    if (!event || !payload) {
      await this.redis.xack(this.streamKey, this.groupName, id);
      return;
    }

    try { 
      switch (event) {
        // ===================== MESSAGE =====================
        case 'message.created': {
          const msg: MessageResponseDTO = JSON.parse(payload);
          this.chatGateway.broadcastNewMessage(msg);
          break;
        }
        case 'message.deleted': {
          const msg: MessageResponseDTO = JSON.parse(payload);
          this.chatGateway.broadcastMessageDeleted(msg);
          break;
        }

        // ===================== CONVERSATION =====================
        case 'conversation.created': {
          const conv: ConversationResponseDTO = JSON.parse(payload);
          this.chatGateway.emitConversationCreated(conv);
          break;
        }
        case 'conversation.updated': {
          const conv: ConversationResponseDTO = JSON.parse(payload);
          this.chatGateway.emitConversationUpdated(conv);
          break;
        }
        case 'conversation.memberJoined': {
          const data: {
            conversationId: string;
            joinedUserId: string;
            participants: string[];
          } = JSON.parse(payload);

          this.chatGateway.emitMemberJoined(
            data.conversationId,
            data.joinedUserId,
            data.participants
          );
          break;
        }
        case 'conversation.memberLeft': {
          const data: {
            conversationId: string;
            leftUserId: string;
            participants: string[];
          } = JSON.parse(payload);

          this.chatGateway.emitMemberLeft(
            data.conversationId,
            data.leftUserId,
            data.participants
          );
          break;
        }
        case 'conversation.deleted': {
          const data: {
            conversationId: string;
            participants: string[];
          } = JSON.parse(payload);

          this.chatGateway.emitConversationDeleted(
            data.conversationId,
            data.participants
          );
          break;
        }
        case 'conversation.read': {
          const data: {
            conversationId: string;
            userId: string;
            lastSeenMessageId: string | null;
          } = JSON.parse(payload);

          this.chatGateway.broadcastConversationRead(
            data.conversationId,
            data.userId,
            data.lastSeenMessageId
          );
          break;
        }

        default:
          this.logger.warn(`Unknown chat event: ${event}`);
          break;
      }

      await this.redis.xack(this.streamKey, this.groupName, id);
    } catch (e) {
      this.logger.error('Failed to process payload from stream', e);
      // ACK luôn để không bị stuck, hoặc giữ pending lại để retry sau.
      await this.redis.xack(this.streamKey, this.groupName, id);
    }
  }
}
