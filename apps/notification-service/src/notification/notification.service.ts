import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateNotificationDto,
  NotificationResponseDto,
  PageResponse,
  PaginationDTO,
} from '@repo/dtos';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Queue } from 'bull';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, ObjectId } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from 'src/mongo/schema/notification.schema';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';
import { TemplateService } from './template.service';
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly defaultMaxRetries = 3;
  private readonly NOTIF_CACHE_TTL = 2 * 60 * 60;
  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<Notification>,
    private readonly templateService: TemplateService,
    private readonly userPreferenceService: UserPreferenceService,
    @InjectQueue('notifications') private notificationQueue: Queue,
    @Inject('RABBITMQ_CHANNEL') private readonly rabbitChannel: ChannelWrapper,
    @InjectRedis() private readonly redis: Redis
  ) {}

  async create(dto: CreateNotificationDto) {
    if (dto.requestId) {
      const exists = await this.notificationModel
        .findOne({ requestId: dto.requestId })
        .lean();
      if (exists) return plainToInstance(NotificationResponseDto, exists, {});
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
        {
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        }
      );
      this.logger.log(`Notification ${doc._id} scheduled in ${delay}ms`);
    } else {
      // immediate -> publish to channels
      try {
        await Promise.all([
          this.publishToChannels(doc),
          this.updateUserCache(doc),
        ]);
      } catch (err) {
        this.logger.error(
          `Failed to process immediate notification ${doc._id}`,
          err
        );
      }
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
  ): Promise<PageResponse<NotificationResponseDto>> {
    const key = `user:${userId}:notifications`;
    const start = (query.page - 1) * query.limit;
    const end = start + query.limit - 1;

    const cached = await this.redis.zrevrange(key, start, end);
    if (cached.length) {
      const items = cached.map((c) => JSON.parse(c));
      const total = await this.redis.zcard(key);
      const notiDTOs = plainToInstance(NotificationResponseDto, items, {});
      return new PageResponse(notiDTOs, total, query.page, query.limit);
    }

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
    if (items.length) {
      const pipeline = this.redis.pipeline();
      for (const item of items) {
        let score: number;
        if ((item as any).createdAt) {
          score = new Date((item as any).createdAt).getTime();
        } else {
          this.logger.warn(
            `Notification item missing createdAt: ${JSON.stringify(item)}`
          );
          score = Date.now();
        }
        pipeline.zadd(key, score, JSON.stringify(item), 'NX');
      }
      pipeline.zremrangebyrank(key, 0, -101);
      pipeline.expire(
        key,
        this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300)
      );
      await pipeline.exec();
    } else {
      await this.redis.set(key, '__empty__', 'EX', 60); // cache sentinel for empty result
    }

    const notiDTOs = plainToInstance(NotificationResponseDto, items, {});
    return new PageResponse(notiDTOs, total, query.page, query.limit);
  }

  async markRead(id: string) {
    const doc = await this.notificationModel.findByIdAndUpdate(
      id,
      { status: 'read' },
      { new: true }
    );
    if (doc) await this.updateUserCache(doc);
    return plainToInstance(NotificationResponseDto, doc, {});
  }

  async markAllRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      { userId, status: { $ne: 'read' } },
      { $set: { status: 'read', updatedAt: new Date() } }
    );

    await this.refreshUserCache(userId);

    return { modified: result.modifiedCount };
  }

  async remove(id: string) {
    const doc = await this.notificationModel.findByIdAndDelete(id);
    if (doc) await this.refreshUserCache(doc.userId);
  }

  async removeAll(userId: string) {
    await this.notificationModel.deleteMany({ userId });
    await this.redis.del(`user:${userId}:notifications`);
  }

  async findById(id: string) {
    return await this.notificationModel.findById(id).lean();
  }

  private async updateUserCache(doc: NotificationDocument) {
    const key = `user:${doc.userId}:notifications`;
    const createdAt = doc.get('createdAt');
    const score = createdAt ? new Date(createdAt).getTime() : Date.now();

    // Convert doc to plain object and DTO before caching
    const plainDoc = doc.toObject ? doc.toObject() : doc;
    const dto = plainToInstance(NotificationResponseDto, plainDoc, {});
    const pipeline = this.redis.pipeline();
    pipeline.zadd(key, score, JSON.stringify(dto));
    pipeline.zremrangebyrank(key, 0, -101); // giữ 100 mới nhất
    pipeline.expire(
      key,
      this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300)
    );
    await pipeline.exec();
  }

  private async refreshUserCache(userId: string) {
    const key = `user:${userId}:notifications`;
    const items = await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const pipeline = this.redis.pipeline();
    pipeline.del(key);
    for (const item of items) {
      const score = new Date((item as any).createdAt ?? Date.now()).getTime();
      pipeline.zadd(key, score, JSON.stringify(item), 'NX');
    }
    pipeline.expire(
      key,
      this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300)
    );
    await pipeline.exec();
  }
}
