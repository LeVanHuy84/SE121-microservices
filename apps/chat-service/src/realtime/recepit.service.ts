// src/receipt/receipt.service.ts
import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import * as kafkajs from 'kafkajs';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { KAFKA } from '../kafka/kafka.module';
import { RedisPubSubService } from '@repo/common';
import { Message } from 'src/mongo/schema/message.schema';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import {
  populateAndMapConversation,
  populateAndMapMessage,
} from 'src/utils/mapping';

@Injectable()
export class ReceiptService implements OnModuleInit {
  private readonly logger = new Logger(ReceiptService.name);
  private consumer: kafkajs.Consumer;
  private readonly TOPIC_DELIVER_IN =
    process.env.KAFKA_TOPIC_DELIVER || 'chat_gateway.message.delivery';
  private readonly TOPIC_READ_IN =
    process.env.KAFKA_TOPIC_READ || 'chat_gateway.message.read';
  private readonly TOPIC_DELETE_IN =
    process.env.KAFKA_TOPIC_DELETE || 'chat_gateway.message.delete';
  private readonly TOPIC_CONV_CREATE =
    process.env.KAFKA_TOPIC_CONV_CREATE || 'chat_gateway.conversation.create';
  private readonly TOPIC_CONVERSATION_READ =
    process.env.KAFKA_TOPIC_CONV_READ || 'chat_gateway.conversation.read';

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
      process.env.KAFKA_GROUP_RECEIPT || 'receipt-service-group',
    );
  }

  async onModuleInit() {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.TOPIC_DELIVER_IN,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: this.TOPIC_READ_IN,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: this.TOPIC_DELETE_IN,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: this.TOPIC_CONVERSATION_READ,
      fromBeginning: false,
    });
    await this.consumer.subscribe({
      topic: this.TOPIC_CONV_CREATE,
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const raw = message.value!.toString();
        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return;
        }
        if (topic === this.TOPIC_DELIVER_IN)
          await this.handleDelivered(payload);
        else if (topic === this.TOPIC_READ_IN) await this.handleRead(payload);
        else if (topic === this.TOPIC_DELETE_IN)
          await this.handleDelete(payload);
        else if (topic === this.TOPIC_CONVERSATION_READ)
          await this.handleConversationRead(payload);
        else if (topic === this.TOPIC_CONV_CREATE)
          await this.handleConversationCreate(payload);
      },
    });
  }

  private async handleDelivered(payload: {
    messageId: string;
    deliveredBy: string;
    timestamp?: number;
  }) {
    const { messageId, deliveredBy } = payload;
    const res = await this.messageModel
      .findOneAndUpdate(
        { messageId },
        { $addToSet: { deliveredBy }, $set: { updatedAt: new Date() } },
        { new: true },
      )
      .lean();
    if (!res) return;

    await this.convModel.updateOne(
      { _id: res.conversationId.toString() },
      { $set: { updatedAt: new Date() } },
    );

    await this.redis.publish(
      'chat:message.status.updated',
      JSON.stringify({
        conversationId: res.conversationId.toString(),
        messageId: res._id.toString(),
        update: 'delivered',
        userId: deliveredBy,
        timestamp: Date.now(),
      }),
    );
    // await this.producer.send({
    //   topic: this.TOPIC_STATUS_OUT,
    //   messages: [
    //     { key: res.conversationId, value: JSON.stringify(statusPayload) },
    //   ],
    // });
  }

  private async handleRead(payload: {
    messageId: string;
    seenBy: string;
    timestamp?: number;
  }) {
    const { messageId, seenBy } = payload;
    const res = await this.messageModel
      .findOneAndUpdate(
        { messageId },
        { $addToSet: { seenBy }, $set: { updatedAt: new Date() } },
        { new: true },
      )
      .lean();
    if (!res) return;

    await this.redis.publish(
      'chat.message.status.updated',
      JSON.stringify({
        conversationId: res.conversationId.toString(),
        messageId: res._id.toString(),
        update: 'seen',
        userId: seenBy,
        timestamp: Date.now(),
      }),
    );

    const convDoc = await this.convModel
      .findByIdAndUpdate(
        { _id: res.conversationId },
        { $set: { updatedAt: new Date() } },
      )
      .populate('lastMessage')
      .lean();

    if (res._id.toString() === convDoc?.lastMessage?._id.toString()) {
      const convDto = await populateAndMapConversation(convDoc);
      await this.redis.publish(
        'chat:conversation.updated',
        JSON.stringify(convDto),
      );
    }
    // await this.producer.send({
    //   topic: this.TOPIC_STATUS_OUT,
    //   messages: [
    //     { key: res.conversationId, value: JSON.stringify(statusPayload) },
    //   ],
    // });
  }

  private async handleDelete(payload: {
    messageId: string;
    deletedBy: string;
    timestamp?: number;
  }) {
    const { messageId, deletedBy } = payload;
    const res = await this.messageModel
      .findOneAndUpdate(
        { messageId },
        {
          $set: {
            isDeleted: true,
            deletedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true },
      )
      .lean();
    if (!res) return;

    await this.redis.publish(
      'chat.message.status.updated',
      JSON.stringify({
        conversationId: res.conversationId.toString(),
        messageId: res._id.toString(),
        update: 'deleted',
        userId: deletedBy,
        timestamp: Date.now(),
      }),
    );
    const convDoc = await this.convModel
      .findByIdAndUpdate(
        { _id: res.conversationId },
        { $set: { updatedAt: new Date() } },
      )
      .populate('lastMessage')
      .lean();

    if (res._id.toString() === convDoc?.lastMessage?._id.toString()) {
      const convDto = await populateAndMapConversation(convDoc);
      await this.redis.publish(
        'chat:conversation.updated',
        JSON.stringify(convDto),
      );
    }
    // await this.producer.send({
    //   topic: this.TOPIC_STATUS_OUT,
    //   messages: [
    //     { key: res.conversationId, value: JSON.stringify(statusPayload) },
    //   ],
    // });
  }

  private async handleConversationCreate(payload: {
    isGroup: boolean;
    participants: string[];
    groupName?: string;
    groupAvatar?: string;
    admins?: string[];
    createdBy: string;
  }) {
    const participants = [...new Set(payload.participants)].sort();
    if (!payload.isGroup && participants.length === 2) {
      const exists = await this.convModel
        .findOne({ isGroup: false, participants })
        .lean();
      if (exists) {
        await this.redis.publish(
          'chat:conversation.created',
          JSON.stringify(exists),
        );
        return;
      }
    }
    const conv = await this.convModel.create({
      isGroup: payload.isGroup,
      participants,
      groupName: payload.groupName,
      groupAvatar: payload.groupAvatar,
      admins: payload.admins || [],
    });

    const convDto = await populateAndMapConversation(conv);

    await this.redis.publish(
      'chat:conversation.created',
      JSON.stringify(convDto),
    );
  }

  private async handleConversationRead(payload: {
    conversationId: string;
    userId: string;
    timestamp?: number;
  }) {
    const { conversationId, userId } = payload;

    // optional: bulk update messages seen
    await this.messageModel.updateMany(
      { conversationId, createdAt: { $lte: new Date() } }, // hoặc dựa vào lastSeenMessage.createdAt
      { $addToSet: { seenBy: userId } },
    );

    const conDoc = await this.convModel
      .findById(conversationId)
      .populate('lastMessage')
      .lean();

    const convDto = await populateAndMapConversation(conDoc);
    await this.redis.publish(
      'chat:conversation.updated',
      JSON.stringify(convDto),
    );
    if (convDto.lastMessage) {
      this.redis.publish(
        'chat:message.status.updated',
        JSON.stringify({
          message: convDto.lastMessage,
          update: 'seen',
          seenBy: userId,
          timestamp: Date.now(),
        }),
      );
    }
    // await this.producer.send({
    //   topic: this.TOPIC_STATUS_OUT,
    //   messages: [{ key: conversationId, value: JSON.stringify(statusPayload) }],
    // });
  }
}
