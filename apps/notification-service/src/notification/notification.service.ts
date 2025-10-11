import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CreateNotificationDto, PageResponse, PaginationDTO } from '@repo/dtos';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Queue } from 'bull';
import { Model, ObjectId } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from 'src/mongo/schema/notification.schema';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';
import { TemplateService } from './template.service';
import { plainToInstance } from 'class-transformer';
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private defaultMaxRetries = 3;
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<Notification>,
    private readonly templateService: TemplateService,
    private readonly userPreferenceService: UserPreferenceService,
    @InjectQueue('notifications') private notificationQueue: Queue,
    @Inject('RABBITMQ_CHANNEL') private readonly rabbitChannel: ChannelWrapper
  ) {}

  async create(dto: CreateNotificationDto) {
    if (dto.requestId) {
      const exists = await this.notificationModel
        .findOne({ requestId: dto.requestId })
        .lean();
      if (exists) return exists;
    }

    // 2. Get user preference and rate-limit
    const prefs = await this.userPreferenceService.getUserPreferences(
      dto.userId
    );
    const allowedChannels =
      dto.channels && dto.channels.length
        ? dto.channels.filter((ch) => prefs.allowedChannels.includes(ch))
        : prefs.allowedChannels;
    if (!allowedChannels || allowedChannels.length === 0) {
      this.logger.warn(`User ${dto.userId} has no allowed channels — skipping`);
      // still store record as "suppressed" if you want; here simply return
      const suppressed = await this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        channels: [],
        status: 'unread',
        meta: { suppressed: true },
      });
      return suppressed;
    }

    // Rate-limiting check (simple daily limit)
    const limit = prefs.limits?.dailyLimit ?? 100;
    const allowed =
      await this.userPreferenceService.checkAndIncrementDailyLimit(
        dto.userId,
        limit
      );
    if (!allowed) {
      this.logger.warn(`User ${dto.userId} exceeded daily limit`);
      const blocked = await this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        channels: [],
        status: 'unread',
        meta: { rateLimited: true },
      });
      return blocked;
    }

    // 3. save to DB
    const sendAt = dto.sendAt ? new Date(dto.sendAt) : undefined;
    const doc = await this.notificationModel.create({
      requestId: dto.requestId,
      userId: dto.userId,
      type: dto.type,
      payload: dto.payload,
      channels: allowedChannels,
      sendAt,
      meta: dto.meta || {},
    });

    // 4. scheduling vs immediate
    if (sendAt && sendAt.getTime() > Date.now()) {
      // schedule via Bull
      const delay = Math.max(0, sendAt.getTime() - Date.now());
      await this.notificationQueue.add(
        'send',
        { id: doc._id },
        { delay, attempts: 3 }
      );
      this.logger.log(`Notification ${doc._id} scheduled in ${delay}ms`);
    } else {
      // immediate -> publish to channels
      await this.publishToChannels(doc);
    }

    return doc;
  }
  async publishToChannels(doc: NotificationDocument) {
    const rendered = this.templateService.render(doc.type, doc.payload);
    const basePayload = {
      id: (doc._id as ObjectId).toString(),
      requestId: doc.requestId,
      userId: doc.userId,
      type: doc.type,
      message: rendered,
      payload: doc.payload,
      meta: doc.meta,
    };

    // ensure maxRetries in meta
    const maxRetries = doc.meta?.maxRetries ?? this.defaultMaxRetries;

    for (const ch of doc.channels) {
      const routingKey = `channel.${ch}`; // e.g. channel.inapp, channel.email
      const headers = {
        'x-request-id': doc.requestId || (doc._id as ObjectId).toString(),
        'x-retries': 0,
        'x-max-retries': doc.meta?.maxRetries ?? maxRetries,
      };
      await this.rabbitChannel.publish(
        'notification_exchange',
        routingKey,
        Buffer.from(JSON.stringify(basePayload)),
        {
          persistent: true,
          contentType: 'application/json',
          headers,
        }
      );
      this.logger.log(`Published notification ${doc._id} -> ${routingKey}`);
    }
  }

  // CRUD helpers
  async findByUser(
    userId: string,
    query: PaginationDTO
  ): Promise<PageResponse<Notification>> {
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await Promise.all([
      this.notificationModel
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .lean(),
      this.notificationModel.countDocuments({ userId }),
    ]);

    const notiDTOs = plainToInstance(Notification, items, {});
    return new PageResponse(notiDTOs, total, query.page, query.limit);
  }

  async markRead(id: string) {
    return await this.notificationModel.findByIdAndUpdate(
      id,
      { status: 'read' },
      { new: true }
    );
  }

  async markAllRead(userId: string) {
    return await this.notificationModel.updateMany(
      { userId },
      { status: 'read' }
    );
  }

  async remove(id: string) {
    return await this.notificationModel.findByIdAndDelete(id);
  }

  async removeAll(userId: string) {
    return await this.notificationModel.deleteMany({ userId });
  }

  async findById(id: string) {
    return await this.notificationModel.findById(id).lean();
  }
}
