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
  private readonly batchSize = Number(
    process.env.CHAT_STREAM_BATCH_SIZE ?? 100
  );
  private readonly blockMs = Number(process.env.CHAT_STREAM_BLOCK_MS ?? 5000);
  private readonly claimIdleMs = Number(
    process.env.CHAT_STREAM_CLAIM_IDLE_MS ?? 60_000
  );
  private readonly claimIntervalMs = Number(
    process.env.CHAT_STREAM_CLAIM_INTERVAL_MS ?? 30_000
  );
  private readonly maxRetries = Number(
    process.env.CHAT_STREAM_MAX_RETRIES ?? 3
  );
  private readonly dlqMaxLen = Number(
    process.env.CHAT_STREAM_DLQ_MAXLEN ?? 5000
  );
  private readonly convVersionTtlSec = Number(
    process.env.CHAT_CONV_VERSION_TTL_SEC ?? 86_400
  );
  private readonly msgVersionTtlSec = Number(
    process.env.CHAT_MSG_VERSION_TTL_SEC ?? 86_400
  );

  private running = false;
  private claimTimer?: NodeJS.Timeout;
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

    this.claimStale().catch((e) => this.logger.error('Error in claimStale', e));

    this.claimTimer = setInterval(() => {
      this.claimStale().catch((e) =>
        this.logger.error('Error in claimStale', e)
      );
    }, this.claimIntervalMs);

    // 2) Bắt đầu loop đọc message mới
    this.consumeLoop();
    this.logger.log(
      `ChatStreamConsumer started group=${this.groupName}, consumer=${this.consumerName}`
    );
  }

  async onModuleDestroy() {
    this.running = false;
    if (this.claimTimer) {
      clearInterval(this.claimTimer);
      this.claimTimer = undefined;
    }
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
        this.batchSize,
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

  private async claimStale() {
    if (!this.running) return;
    try {
      const res = await (this.redis as any).xautoclaim(
        this.streamKey,
        this.groupName,
        this.consumerName,
        this.claimIdleMs,
        '0-0',
        'COUNT',
        this.batchSize
      );

      const entries = (res?.[1] as any[]) || [];
      for (const [id, fields] of entries) {
        await this.processEntry(id, fields);
      }
    } catch (e) {
      this.logger.error('Error in claimStale', e);
    }
  }

  private async consumeLoop() {
    while (this.running) {
      try {
        const res = await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'COUNT',
          this.batchSize,
          'BLOCK',
          this.blockMs,
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
    const retries = Number(obj.retries ?? 0);

    if (!event || !payload) {
      await this.redis.xack(this.streamKey, this.groupName, id);
      return;
    }

    try {
      switch (event) {
        // ===================== MESSAGE =====================
        case 'message.created': {
          const msg: MessageResponseDTO = JSON.parse(payload);
          if (await this.shouldProcessMessageEvent(msg)) {
            this.chatGateway.broadcastNewMessage(msg);
          }
          break;
        }
        case 'message.deleted': {
          const msg: MessageResponseDTO = JSON.parse(payload);
          if (await this.shouldProcessMessageEvent(msg)) {
            this.chatGateway.broadcastMessageDeleted(msg);
          }
          break;
        }

        // ===================== CONVERSATION =====================
        case 'conversation.created': {
          const conv: ConversationResponseDTO = JSON.parse(payload);
          if (await this.shouldProcessConversationEvent(conv)) {
            this.chatGateway.emitConversationCreated(conv);
          }
          break;
        }
        case 'conversation.updated': {
          const conv: ConversationResponseDTO = JSON.parse(payload);
          if (await this.shouldProcessConversationEvent(conv)) {
            this.chatGateway.emitConversationUpdated(conv);
          }
          break;
        }
        case 'conversation.memberJoined': {
          const data: {
            conversation: ConversationResponseDTO;
            joinedUserIds: string[];
          } = JSON.parse(payload);

          if (await this.shouldProcessConversationEvent(data.conversation)) {
            this.chatGateway.emitMemberJoined(
              data.conversation,
              data.joinedUserIds
            );
          }
          break;
        }
        case 'conversation.memberLeft': {
          const data: {
            conversationId: string;
            leftUserIds: string[];
          } = JSON.parse(payload);

          this.chatGateway.emitMemberLeft(
            data.conversationId,
            data.leftUserIds
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
      if (retries < this.maxRetries) {
        try {
          await this.redis.xadd(
            this.streamKey,
            '*',
            'event',
            event,
            'payload',
            payload,
            'retries',
            String(retries + 1)
          );
        } catch (requeueErr) {
          this.logger.error('Failed to requeue chat event', requeueErr);
        }
      } else {
        try {
          await this.redis.xadd(
            `${this.streamKey}:dlq`,
            '*',
            'MAXLEN',
            '~',
            this.dlqMaxLen,
            'event',
            event,
            'payload',
            payload,
            'retries',
            String(retries),
            'error',
            (e as Error)?.message ?? 'unknown_error'
          );
        } catch (dlqErr) {
          this.logger.error('Failed to push chat event to DLQ', dlqErr);
        }
      }
      await this.redis.xack(this.streamKey, this.groupName, id);
    }
  }

  private async shouldProcessConversationEvent(
    conv: ConversationResponseDTO
  ): Promise<boolean> {
    const convId = conv?._id?.toString?.() ?? conv?._id;
    if (!convId) return true;
    const syncVersion = Number((conv as any).syncVersion ?? 0);
    if (!syncVersion) return true;

    const key = `conv:${convId}:syncVersion`;
    const script = `
      local k = KEYS[1]
      local newVersion = tonumber(ARGV[1])
      local ttl = tonumber(ARGV[2])
      local current = redis.call('GET', k)
      if not current then
        redis.call('SET', k, newVersion, 'EX', ttl)
        return 1
      end
      local cur = tonumber(current) or 0
      if cur <= newVersion then
        redis.call('SET', k, newVersion, 'EX', ttl)
        return 1
      end
      return 0
    `;

    const res = await this.redis.eval(
      script,
      1,
      key,
      String(syncVersion),
      String(this.convVersionTtlSec)
    );

    return Number(res) === 1;
  }

  private async shouldProcessMessageEvent(
    msg: MessageResponseDTO
  ): Promise<boolean> {
    const msgId = msg?._id?.toString?.() ?? msg?._id;
    if (!msgId) return true;
    const syncVersion = Number((msg as any).syncVersion ?? 0);
    if (!syncVersion) return true;

    const key = `msg:${msgId}:syncVersion`;
    const script = `
      local k = KEYS[1]
      local newVersion = tonumber(ARGV[1])
      local ttl = tonumber(ARGV[2])
      local current = redis.call('GET', k)
      if not current then
        redis.call('SET', k, newVersion, 'EX', ttl)
        return 1
      end
      local cur = tonumber(current) or 0
      if cur <= newVersion then
        redis.call('SET', k, newVersion, 'EX', ttl)
        return 1
      end
      return 0
    `;

    const res = await this.redis.eval(
      script,
      1,
      key,
      String(syncVersion),
      String(this.msgVersionTtlSec)
    );

    return Number(res) === 1;
  }
}
