// src/storage/message-consumer.service.ts
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import * as kafkajs from 'kafkajs';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { KAFKA } from '../kafka/kafka.module';
import { RedisPubSubService } from '@repo/common';
import { Message } from 'src/mongo/schema/message.schema';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { plainToInstance } from 'class-transformer';
import { MessageResponseDTO } from '@repo/dtos';
import {
  populateAndMapConversation,
  populateAndMapMessage,
} from 'src/utils/mapping';

@Injectable()
export class MessageConsumerService implements OnModuleInit {
  private readonly logger = new Logger(MessageConsumerService.name);
  private consumer: kafkajs.Consumer;
  private readonly TOPIC =
    process.env.KAFKA_TOPIC_MESSAGES || 'chat_gateway.messages';
  private readonly DLQ =
    process.env.KAFKA_TOPIC_MESSAGES_DLQ || 'chat.messages.dlq';
  private readonly MAX_RETRIES = Number(process.env.CONSUMER_MAX_RETRIES || 5);

  constructor(
    @Inject(KAFKA.CONSUMER_FACTORY)
    consumerFactory: (g: string) => kafkajs.Consumer,
    @Inject(KAFKA.PRODUCER) private readonly producer: kafkajs.Producer,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name)
    private readonly convModel: Model<Conversation>,
    @Inject('REDIS_CHAT') private readonly redis: RedisPubSubService,
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
        const raw = message.value!.toString();
        let env: any;
        try {
          env = JSON.parse(raw);
        } catch {
          await this.producer.send({
            topic: this.DLQ,
            messages: [
              {
                key: 'invalid',
                value: JSON.stringify({
                  payload: raw,
                  reason: 'invalid_json',
                  ts: Date.now(),
                }),
              },
            ],
          });
          return;
        }
        await this.processWithRetry(env);
      },
    });
  }

  private async processWithRetry(env: any) {
    let attempt = 0;
    while (attempt < this.MAX_RETRIES) {
      try {
        await this.persist(env);
        return;
      } catch (err) {
        attempt++;
        if (this.isTransient(err) && attempt < this.MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 200));
          continue;
        }
        await this.producer.send({
          topic: this.DLQ,
          messages: [
            {
              key: env.conversationId,
              value: JSON.stringify({
                payload: env,
                reason: String(err),
                attempts: attempt,
                ts: Date.now(),
              }),
            },
          ],
        });
        return;
      }
    }
  }

  private async persist(env: any) {
    const session = await this.messageModel.db.startSession();
    try {
      session.startTransaction();

      const exists = await this.messageModel
        .findOne({ messageId: env.messageId })
        .session(session);
      if (exists) {
        await session.commitTransaction();
        session.endSession();

        this.redis.publish(
          'chat:error',
          JSON.stringify({
            error: 'duplicate_message',
            messageId: env.messageId,
          }),
        );
        return;
      }

      const created = await this.messageModel.create(
        [
          {
            messageId: env.messageId,
            conversationId: env.conversationId,
            senderId: env.senderId,
            content:
              typeof env.content === 'string'
                ? env.content
                : JSON.stringify(env.content),
            status: 'sent',
            deliveredBy: [],
            seenBy: [env.senderId],
            reactions: env.reactions ?? [],
            attachments: env.attachments ?? [],
            replyTo: env.replyTo ? env.replyTo : null,
          },
        ],
        { session },
      );

      let msgDoc = created[0];

      if (msgDoc.replyTo) {
        msgDoc = await msgDoc.populate('replyTo');
      }

      const convDoc = await this.convModel
        .findByIdAndUpdate(
          { _id: env.conversationId },
          {
            $set: { lastMessage: msgDoc._id.toString(), updatedAt: new Date() },
          },
          { session },
        )
        .populate('lastMessage')
        .lean();

      await session.commitTransaction();
      session.endSession();

      //Map to DTO
      const msgDto = await populateAndMapMessage(msgDoc);
      const convDto = await populateAndMapConversation(convDoc);

      await Promise.all([
        this.redis.publish(
          'chat:message.stored',
          JSON.stringify({
            conversationId: env.conversationId,
            message: msgDto,
          }),
        ),
        this.redis.publish(
          'chat:conversation.updated',
          JSON.stringify({ conversation: convDto }),
        ),
      ]);
    } catch (err: any) {
      await session.abortTransaction();
      session.endSession();
      if (err?.code === 11000) return;
      throw err;
    }
  }

  private isTransient(err: any) {
    const s = String(err || '');
    return [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENETUNREACH',
      'ECONNREFUSED',
      'MongoNetworkError',
    ].some((x) => s.includes(x));
  }
}
