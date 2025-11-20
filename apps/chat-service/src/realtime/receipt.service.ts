// src/receipt/receipt.service.ts
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as kafkajs from 'kafkajs';
import { Model } from 'mongoose';

import { RedisPubSubService } from '@repo/common';
import { Conversation } from 'src/mongo/schema/conversation.schema';
import { Message } from 'src/mongo/schema/message.schema';
import { populateAndMapConversation } from 'src/utils/mapping';
import { KAFKA } from '../kafka/kafka.module';
import { ConversationService } from 'src/conversation/conversation.service';
import { MessageService } from 'src/message/message.service';

type DeliveredPayload = {
  messageId: string;
  deliveredBy: string;
  timestamp?: number;
};
type ReadPayload = { messageId: string; seenBy: string; timestamp?: number };
type DeletePayload = {
  messageId: string;
  deletedBy: string;
  timestamp?: number;
};
type ConvCreatePayload = {
  isGroup: boolean;
  participants: string[];
  groupName?: string;
  groupAvatar?: string;
  admins?: string[];
  createdBy: string;
};
type ConvReadPayload = {
  conversationId: string;
  userId: string;
  timestamp?: number;
};

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

  private readonly DLQ =
    process.env.KAFKA_TOPIC_MESSAGES_DLQ || 'chat.messages.dlq';

  constructor(
    @Inject(KAFKA.CONSUMER_FACTORY)
    consumerFactory: (g: string) => kafkajs.Consumer,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
    @InjectModel(Conversation.name)
    private readonly convModel: Model<Conversation>,
    @Inject('REDIS_CHAT') private readonly redis: RedisPubSubService,
    @Inject(KAFKA.PRODUCER) private readonly producer: kafkajs.Producer,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
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
        const raw = message.value?.toString() ?? '';
        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          await this.sendDLQ('invalid_json', { payload: raw });
          return;
        }

        try {
          if (topic === this.TOPIC_DELIVER_IN)
            await this.handleDelivered(payload as DeliveredPayload);
          else if (topic === this.TOPIC_READ_IN)
            await this.handleRead(payload as ReadPayload);
          else if (topic === this.TOPIC_DELETE_IN)
            await this.handleDelete(payload as DeletePayload);
          else if (topic === this.TOPIC_CONVERSATION_READ)
            await this.handleConversationRead(payload as ConvReadPayload);
          else if (topic === this.TOPIC_CONV_CREATE)
            await this.handleConversationCreate(payload as ConvCreatePayload);
        } catch (err: any) {
          // publish generic handler error

          this.logger.error(
            `Handler exception on topic ${topic}: ${String(err)}`,
          );
        }
      },
    });

    this.logger.log('ReceiptService consumer initialized');
  }

  // -------- Handlers with validation --------

  private async handleDelivered(payload: DeliveredPayload) {
    const { messageId, deliveredBy, timestamp } = payload;
    if (!messageId || !deliveredBy) {
      await this.publishError(deliveredBy, 'invalid_delivered_payload', {
        payload,
      });
      return;
    }

    const msg = await this.messageModel.findById(messageId).lean();
    if (!msg) {
      await this.publishError(deliveredBy, 'message_not_found', { messageId });
      return;
    }

    // Optional: validate deliveredBy in conversation participants
    const conv = await this.convModel.findById(msg.conversationId).lean();
    if (!conv) {
      await this.publishError(deliveredBy, 'conversation_not_found', {
        conversationId: msg.conversationId,
      });
      return;
    }
    if (!conv.participants?.includes(deliveredBy)) {
      await this.publishError(deliveredBy, 'not_member', {
        conversationId: msg.conversationId,
        userId: deliveredBy,
      });
      return;
    }

    const updated = await this.messageModel
      .findOneAndUpdate(
        { _id: messageId },
        {
          $addToSet: { deliveredBy },
          $set: { updatedAt: timestamp ? new Date(timestamp) : new Date() },
        },
        { new: true },
      )
      .lean();
    if (!updated) return;

    await this.convModel.updateOne(
      { _id: updated.conversationId.toString() },
      { $set: { status: 'delivered', updatedAt: new Date() } },
    );

    await Promise.all([
      this.redis.publish(
        'chat:message.status.updated',
        JSON.stringify({
          conversationId: updated.conversationId.toString(),
          messageId: updated._id.toString(),
          update: 'delivered',
          userId: deliveredBy,
          timestamp: Date.now(),
        }),
      ),
      this.messageService.updateMessageCache(updated),
    ]);
  }

  private async handleRead(payload: ReadPayload) {
    const { messageId, seenBy, timestamp } = payload;
    if (!messageId || !seenBy) {
      await this.publishError(seenBy, 'invalid_read_payload', { payload });
      return;
    }

    const msg = await this.messageModel.findById(messageId).lean();
    if (!msg) {
      await this.publishError(seenBy, 'message_not_found', { messageId });
      return;
    }

    const conv = await this.convModel.findById(msg.conversationId).lean();
    if (!conv) {
      await this.publishError(seenBy, 'conversation_not_found', {
        conversationId: msg.conversationId,
      });
      return;
    }
    if (!conv.participants?.includes(seenBy)) {
      await this.publishError(seenBy, 'not_member', {
        conversationId: msg.conversationId,
        userId: seenBy,
      });
      return;
    }

    const updated = await this.messageModel
      .findOneAndUpdate(
        { _id: messageId },
        {
          $addToSet: { seenBy },
          $set: { status: 'seen', updatedAt: new Date() },
        },
        { new: true },
      )
      .lean();
    if (!updated) return;

    await Promise.all([
      this.redis.publish(
        'chat:message.status.updated',
        JSON.stringify({
          conversationId: updated.conversationId.toString(),
          messageId: updated._id.toString(),
          update: 'seen',
          userId: seenBy,
          timestamp: Date.now(),
        }),
      ),
      this.messageService.updateMessageCache(updated),
    ]);

    const convDoc = await this.convModel
      .findByIdAndUpdate(
        { _id: updated.conversationId },
        { $set: { updatedAt: timestamp ? new Date(timestamp) : new Date() } },
        { new: true },
      )
      .populate('lastMessage')
      .lean();

    if (updated._id.toString() === convDoc?.lastMessage?._id.toString()) {
      const convDto = await populateAndMapConversation(convDoc);

      await Promise.all([
        this.redis.publish(
          'chat:conversation.updated',
          JSON.stringify(convDto),
        ),
        this.conversationService.updateConversationCache(convDto),
      ]);
    }
  }

  private async handleDelete(payload: DeletePayload) {
    const { messageId, deletedBy, timestamp } = payload;
    if (!messageId || !deletedBy) {
      await this.publishError(deletedBy, 'invalid_delete_payload', { payload });
      return;
    }

    const msg = await this.messageModel.findById(messageId).lean();
    if (!msg) {
      await this.publishError(deletedBy, 'message_not_found', { messageId });
      return;
    }

    const conv = await this.convModel.findById(msg.conversationId).lean();
    if (!conv) {
      await this.publishError(deletedBy, 'conversation_not_found', {
        conversationId: msg.conversationId,
      });
      return;
    }
    if (!conv.participants?.includes(deletedBy)) {
      await this.publishError(deletedBy, 'not_member', {
        conversationId: msg.conversationId,
        userId: deletedBy,
      });
      return;
    }

    // Chỉ cho phép người gửi xóa
    if (String(msg.senderId) !== String(deletedBy)) {
      await this.publishError(deletedBy, 'not_owner', {
        messageId,
        deletedBy,
        ownerId: msg.senderId,
      });
      return;
    }

    // Optional: nếu muốn chặn xóa lại
    if (msg.isDeleted) {
      await this.publishError(deletedBy, 'already_deleted', { messageId });
      return;
    }

    const updated = await this.messageModel
      .findOneAndUpdate(
        { _id: messageId },
        {
          $set: {
            isDeleted: true,
            deletedAt: timestamp ? new Date(timestamp) : new Date(),
            updatedAt: timestamp ? new Date(timestamp) : new Date(),
          },
        },
        { new: true },
      )
      .lean();
    if (!updated) return;

    await Promise.all([
      this.redis.publish(
        'chat:message.status.updated',
        JSON.stringify({
          conversationId: updated.conversationId.toString(),
          messageId: updated._id.toString(),
          update: 'deleted',
          userId: deletedBy,
          timestamp: Date.now(),
        }),
      ),
      this.messageService.updateMessageCache(updated),
    ]);

    const convDoc = await this.convModel
      .findByIdAndUpdate(
        { _id: updated.conversationId },
        { $set: { updatedAt: new Date() } },
        { new: true },
      )
      .populate('lastMessage')
      .lean();

    if (updated._id.toString() === convDoc?.lastMessage?._id.toString()) {
      const convDto = await populateAndMapConversation(convDoc);

      await Promise.all([
        this.redis.publish(
          'chat:conversation.updated',
          JSON.stringify(convDto),
        ),
        this.conversationService.updateConversationCache(convDto),
      ]);
    }
  }

  private async handleConversationCreate(payload: ConvCreatePayload) {
    const participants = [...new Set(payload.participants)]
      .filter((p) => p && p.trim() !== '')
      .sort();

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

    if (payload.isGroup) {
      if (!payload.groupName) {
        await this.publishError(payload.createdBy, 'group_name_required', {
          createdBy: payload.createdBy,
        });
        return;
      }
      const MAX_GROUP_SIZE = Number(process.env.MAX_GROUP_SIZE || 100);
      if (participants.length > MAX_GROUP_SIZE) {
        await this.publishError(payload.createdBy, 'group_size_exceeded', {
          size: participants.length,
        });
        return;
      }
    }

    const conv = await this.convModel.create({
      isGroup: payload.isGroup,
      participants,
      groupName: payload.groupName,
      groupAvatar: payload.groupAvatar,
      admins: payload.admins || (payload.isGroup ? [payload.createdBy] : []),
    });

    const convDto = await populateAndMapConversation(conv);

    await Promise.all([
      this.redis.publish('chat:conversation.created', JSON.stringify(convDto)),

      this.conversationService.updateConversationCache(conv),
    ]);
  }

  private async handleConversationRead(payload: ConvReadPayload) {
    const { conversationId, userId, timestamp } = payload;
    if (!conversationId || !userId) {
      await this.publishError(userId, 'invalid_conv_read_payload', { payload });
      return;
    }

    const conv = await this.convModel.findById(conversationId).lean();
    if (!conv) {
      await this.publishError(userId, 'conversation_not_found', {
        conversationId,
      });
      return;
    }
    if (!conv.participants?.includes(userId)) {
      await this.publishError(userId, 'not_member', { conversationId, userId });
      return;
    }

    await this.messageModel.updateMany(
      {
        conversationId,
        createdAt: { $lte: timestamp ? new Date(timestamp) : new Date() },
      },
      { $addToSet: { status: 'seen', seenBy: userId } },
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
      await Promise.all([
        this.redis.publish(
          'chat:message.status.updated',
          JSON.stringify({
            message: convDto.lastMessage,
            update: 'seen',
            seenBy: userId,
            timestamp: Date.now(),
          }),
        ),
        this.conversationService.updateConversationCache(conDoc),
      ]);
    }
  }

  // -------- Helpers --------

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
}
