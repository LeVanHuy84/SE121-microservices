import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as kafkajs from 'kafkajs';
import { Model } from 'mongoose';

import { RedisPubSubService } from '@repo/common';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { Message } from 'src/mongo/schema/message.schema';
import {
  populateAndMapConversation,
  populateAndMapMessage,
} from 'src/utils/mapping';
import { KAFKA } from '../kafka/kafka.module';
import { MessageService } from 'src/message/message.service';
import { ConversationService } from 'src/conversation/conversation.service';

type Envelope = {
  messageId: string;
  conversationId: string;
  senderId: string;
  content: string | Record<string, unknown>;
  reactions?: any[];
  attachments?: any[];
  replyTo?: string | null;
};

@Injectable()
export class MessageConsumerService implements OnModuleInit {
  private readonly logger = new Logger(MessageConsumerService.name);
  private consumer: kafkajs.Consumer;

  private readonly TOPIC =
    process.env.KAFKA_TOPIC_MESSAGES || 'chat_gateway.messages';
  private readonly DLQ =
    process.env.KAFKA_TOPIC_MESSAGES_DLQ || 'chat.messages.dlq';
  private readonly MAX_RETRIES = Number(process.env.CONSUMER_MAX_RETRIES || 5);
  private readonly MAX_CONTENT_LENGTH = Number(
    process.env.MESSAGE_MAX_LENGTH || 5000,
  );

  constructor(
    @Inject(KAFKA.CONSUMER_FACTORY)
    consumerFactory: (g: string) => kafkajs.Consumer,
    @Inject(KAFKA.PRODUCER) private readonly producer: kafkajs.Producer,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name)
    private readonly convModel: Model<Conversation>,
    @Inject('REDIS_CHAT') private readonly redis: RedisPubSubService,

    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
  ) {
    this.consumer = consumerFactory(
      process.env.KAFKA_GROUP_MESSAGE_STORAGE || 'message-storage-group',
    );
  }

  async onModuleInit() {
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.TOPIC, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const raw = message.value?.toString() ?? '';
        const env = this.safeParseEnvelope(raw);
        if (!env) {
          await this.sendDLQ('invalid_json', { payload: raw });
          return;
        }
        await this.processWithRetry(env);
      },
    });
    this.logger.log('MessageConsumerService initialized');
  }

  private safeParseEnvelope(raw: string): Envelope | null {
    try {
      const obj = JSON.parse(raw);
      if (!obj?.messageId || !obj?.conversationId || !obj?.senderId)
        return null;
      return obj as Envelope;
    } catch {
      return null;
    }
  }

  private async processWithRetry(env: Envelope) {
    let attempt = 0;
    while (attempt < this.MAX_RETRIES) {
      try {
        await this.persist(env);
        this.logger.debug(`Processed message ${env.messageId}`);
        return;
      } catch (err: any) {
        attempt++;
        if (this.isTransient(err) && attempt < this.MAX_RETRIES) {
          await this.backoff(attempt);
          this.logger.warn(
            `Transient error for ${env.messageId}, attempt ${attempt}: ${String(err)}`,
          );
          continue;
        }
        await this.sendDLQ('persist_failed', {
          payload: env,
          attempts: attempt,
          reason: String(err),
        });
        this.logger.error(
          `Final failure for ${env.messageId} after ${attempt} attempts: ${String(err)}`,
        );
        return;
      }
    }
  }

  private async persist(env: Envelope) {
    const conv = await this.validateEnvelope(env);

    const exists = await this.messageModel
      .findOne({ messageId: env.messageId })
      .lean();
    if (exists) {
      await this.publishError(env.senderId, 'duplicate_message', {
        messageId: env.messageId,
        conversationId: env.conversationId,
      });
      return;
    }

    const session = await this.messageModel.db.startSession();
    try {
      session.startTransaction();

      const contentStr =
        typeof env.content === 'string'
          ? env.content
          : JSON.stringify(env.content);

      const [created] = await this.messageModel.create(
        [
          {
            messageId: env.messageId,
            conversationId: env.conversationId,
            senderId: env.senderId,
            content: contentStr,
            status: 'sent',
            deliveredBy: [],
            seenBy: [env.senderId],
            reactions: env.reactions ?? [],
            attachments: env.attachments ?? [],
            replyTo: env.replyTo || null,
          },
        ],
        { session },
      );

      let msgDoc = created;
      if (msgDoc.replyTo) {
        msgDoc = await msgDoc.populate('replyTo');
      }

      const convDoc = await this.convModel
        .findByIdAndUpdate(
          env.conversationId,
          {
            $set: { lastMessage: msgDoc._id.toString(), updatedAt: new Date() },
          },
          { session, new: true },
        )
        .populate('lastMessage')
        .lean();

      await session.commitTransaction();

      const [msgDto, convDto] = await Promise.all([
        populateAndMapMessage(msgDoc),
        populateAndMapConversation(convDoc),
      ]);

      await Promise.all([
        this.publishStoredMessage(env.conversationId, msgDto),
        this.publishConversationUpdated(convDto),
        this.messageService.updateMessageCache(msgDoc),
        this.conversationService.updateConversationCache(convDoc)
      ]);

      await this.fanOutMessage(env, convDoc);
    } catch (err: any) {
      await session.abortTransaction();
      await this.publishError(env.senderId, 'persist_exception', {
        messageId: env.messageId,
        reason: err.message,
      });
      throw err;
    } finally {
      session.endSession();
    }
  }

  private async validateEnvelope(env: Envelope) {
    const conv = await this.convModel.findById(env.conversationId).lean();
    if (!conv) {
      await this.publishError(env.senderId, 'conversation_not_found', {
        conversationId: env.conversationId,
        senderId: env.senderId,
      });
      throw new Error('conversation_not_found');
    }

    if (!conv.participants.includes(env.senderId)) {
      await this.publishError(env.senderId, 'not_member', {
        conversationId: env.conversationId,
        senderId: env.senderId,
      });
      throw new Error('not_member');
    }

    if (typeof env.content === 'string') {
      const trimmed = env.content.trim();
      if (!trimmed) {
        await this.publishError(env.senderId, 'empty_content', {
          messageId: env.messageId,
        });
        throw new Error('empty_content');
      }
      if (trimmed.length > this.MAX_CONTENT_LENGTH) {
        await this.publishError(env.senderId, 'content_too_long', {
          messageId: env.messageId,
        });
        throw new Error('content_too_long');
      }
    }

    if (env.replyTo) {
      const replyMsg = await this.messageModel.findById(env.replyTo).lean();
      if (
        !replyMsg ||
        String(replyMsg.conversationId) !== String(env.conversationId)
      ) {
        await this.publishError(env.senderId, 'invalid_replyTo', {
          messageId: env.messageId,
          replyTo: env.replyTo,
        });
        throw new Error('invalid_replyTo');
      }
    }

    return conv;
  }

  private isTransient(err: any) {
    const s = String(err?.message || err || '');
    return [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENETUNREACH',
      'ECONNREFUSED',
      'MongoNetworkError',
    ].some((x) => s.includes(x));
  }

  private async backoff(attempt: number) {
    const ms = Math.min(2000, Math.pow(2, attempt) * 200);
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---- Publish helpers ----
  private async sendDLQ(reason: string, payload: Record<string, any>) {
    await this.producer.send({
      topic: this.DLQ,
      messages: [
        {
          key: payload?.payload?.conversationId || 'dlq',
          value: JSON.stringify({ reason, ...payload, ts: Date.now() }),
        },
      ],
      acks: -1,
    });
  }

  private async publishError(
    userId: string,
    code: string,
    data: Record<string, any>,
  ) {
    await this.redis.publish(
      'chat:error',
      JSON.stringify({ userId, code, ...data, ts: Date.now() }),
    );
  }

  private async publishStoredMessage(conversationId: string, message: any) {
    await this.redis.publish(
      'chat:message.stored',
      JSON.stringify({ conversationId, message, ts: Date.now() }),
    );
  }

  private async publishConversationUpdated(convDto: any) {
    await this.redis.publish(
      'chat:conversation.updated',
      JSON.stringify({ ...convDto, ts: Date.now() }),
    );
  }

  private async fanOutMessage(env: any, conv: any) {
    const participants = conv.participants ?? [];
    const byServer = new Map<string, string[]>();

    for (const uid of participants) {
      if (uid === env.senderId) continue;
      const serverId = await this.redis.hget(`presence:user:${uid}`, 'server');
      if (serverId) {
        const arr = byServer.get(serverId) ?? [];
        arr.push(uid);
        byServer.set(serverId, arr);
        this.logger.debug(
          `Queued message ${env.messageId} for user ${uid} via server ${serverId}`,
        );
      } else {
        await this.redis.publish(
          'notifications.in',
          JSON.stringify({ userId: uid, message: env }),
        );
      }
    }

    for (const [srv, uids] of byServer.entries()) {
      const payload = JSON.stringify({ toUserIds: uids, message: env });
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
  }
}
