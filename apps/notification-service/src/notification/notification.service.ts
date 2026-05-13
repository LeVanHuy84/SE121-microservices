import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateNotificationDto,
  CursorPageResponse,
  CursorPaginationDTO,
  NotificationResponseDto,
} from '@repo/dtos';
import type { Queue } from 'bull';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, ObjectId, Types } from 'mongoose';
import { DeviceTokenService } from 'src/firebase/device-token.service';
import { FirebaseService } from 'src/firebase/firebase.service';
import {
  Notification,
  NotificationDocument,
} from 'src/mongo/schema/notification.schema';
import { UserPreferenceService } from 'src/user-preference/user-preference.service';
import {
  NOTIFICATION_QUEUE,
  REGULAR_NOTIFICATION_DELIVERY_JOB,
} from './notification.jobs';
import { TemplateService } from './template.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly notifCacheTtl = 2 * 60 * 60;
  private readonly emptyCacheTtl = 60;

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    private readonly templateService: TemplateService,
    private readonly userPreferenceService: UserPreferenceService,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    @InjectRedis()
    private readonly redis: Redis,
    private readonly firebaseService: FirebaseService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  async createAndEnqueue(dto: CreateNotificationDto) {
    if (dto.requestId) {
      const exists = await this.notificationModel
        .findOne({ requestId: dto.requestId })
        .lean();
      if (exists) {
        return plainToInstance(NotificationResponseDto, exists, {});
      }
    }

    const prefs = await this.userPreferenceService.getUserPreferences(
      dto.userId,
    );
    const allowedChannels =
      dto.channels && dto.channels.length
        ? dto.channels.filter((channel) =>
            prefs.allowedChannels.includes(channel),
          )
        : prefs.allowedChannels;

    if (!allowedChannels || allowedChannels.length === 0) {
      this.logger.warn(`User ${dto.userId} has no allowed channels - skipping`);
      return this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        message: null,
        channels: [],
        status: 'unread',
        meta: { suppressed: true },
      });
    }

    const limitResult = await this.userPreferenceService.reserveNotificationSlot(
      dto.userId,
      dto.type,
      prefs.limits,
    );

    if (!limitResult.allowed) {
      this.logger.warn(
        `User ${dto.userId} exceeded ${limitResult.reason} limit for notification type ${dto.type}`,
      );
      return this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        message: null,
        channels: [],
        status: 'unread',
        meta: {
          rateLimited: true,
          rateLimitReason: limitResult.reason,
          dailyCount: limitResult.dailyCount,
          burstCount: limitResult.burstCount,
        },
      });
    }

    try {
      const renderedTemplate = this.templateService.renderTemplate(
        dto.type,
        dto.payload,
      );
      const sendAt = dto.sendAt ? new Date(dto.sendAt) : undefined;

      const doc = await this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        message: renderedTemplate.body,
        channels: allowedChannels,
        sendAt,
        status: 'unread',
        meta: dto.meta || {},
      });

      try {
        await this.cacheNotifications(doc.userId, [doc]);
      } catch (error) {
        this.logger.warn(
          `Failed to update notification cache for ${doc._id}: ${error.message}`,
        );
      }

      const delay =
        sendAt && sendAt.getTime() > Date.now()
          ? Math.max(0, sendAt.getTime() - Date.now())
          : 0;

      await this.notificationQueue.add(
        REGULAR_NOTIFICATION_DELIVERY_JOB,
        { id: doc._id.toString() },
        {
          jobId: `regular:${doc._id.toString()}`,
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      );

      if (delay > 0) {
        this.logger.log(`Notification ${doc._id} scheduled in ${delay}ms`);
      } else {
        this.logger.log(`Notification ${doc._id} enqueued for delivery`);
      }

      return doc;
    } catch (error) {
      await this.userPreferenceService.releaseNotificationSlot(
        dto.userId,
        dto.type,
        prefs.limits,
      );
      throw error;
    }
  }

  async publishToChannels(doc: NotificationDocument) {
    await this.sendPushNotification(doc);
    this.logger.log(
      `Sent push notification ${doc._id} via FCM to user ${doc.userId}`,
    );
  }

  async findById(id: string) {
    const doc = await this.notificationModel.findById(id).lean();
    return plainToInstance(NotificationResponseDto, doc, {});
  }

  async findByUser(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<NotificationResponseDto>> {
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const limit = query.limit;

    const isEmpty = await this.redis.exists(emptyKey);
    if (isEmpty) {
      return new CursorPageResponse<NotificationResponseDto>([], null, false);
    }

    let maxScore = '+inf';
    if (query.cursor) {
      maxScore = `(${query.cursor}`;
    }

    try {
      const ids = await this.redis.zrevrangebyscore(
        key,
        maxScore,
        '-inf',
        'LIMIT',
        0,
        limit + 1,
      );

      if (ids.length > 0) {
        const hasNext = ids.length > limit;
        const selectedIds = ids.slice(0, limit);

        const cached = await this.redis.hmget(dataKey, ...selectedIds);
        const cachedItems = cached
          .filter((item): item is string => item !== null)
          .map((item) => JSON.parse(item));

        const itemMap = new Map<string, any>();
        for (const item of cachedItems) {
          const id = item?._id?.toString() ?? item?.id;
          if (id) {
            itemMap.set(id, item);
          }
        }

        const missingIds = selectedIds.filter((id) => !itemMap.has(id));
        const items = selectedIds
          .map((id) => itemMap.get(id))
          .filter(Boolean);

        const lastItem = items.length > 0 ? items[items.length - 1] : null;
        const nextCursor =
          hasNext && (lastItem as any)?.createdAt
            ? new Date((lastItem as any).createdAt).getTime().toString()
            : null;

        if (missingIds.length > 0) {
          if (items.length > 0) {
            this.refreshNotificationsCache(userId, query.cursor ?? null, limit)
              .catch((error) =>
                this.logger.warn(
                  `Failed to refresh notifications cache for userId=${userId}: ${error.message}`,
                ),
              );
            return new CursorPageResponse(
              plainToInstance(NotificationResponseDto, items),
              nextCursor,
              hasNext,
            );
          }
        } else {
          return new CursorPageResponse(
            plainToInstance(NotificationResponseDto, items),
            nextCursor,
            hasNext,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `Notification cache read failed for userId=${userId}: ${error.message}`,
      );
    }

    const scoreFilter = query.cursor
      ? { $lt: new Date(parseInt(query.cursor, 10)) }
      : {};

    const dbItems = await this.notificationModel
      .find({ userId, ...(query.cursor ? { createdAt: scoreFilter } : {}) })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    if (dbItems.length > 0) {
      await this.cacheNotifications(userId, dbItems);

      const hasNext = dbItems.length > limit;
      const items = dbItems.slice(0, limit);
      const lastItem = items.length > 0 ? items[items.length - 1] : null;
      const nextCursor =
        hasNext && (lastItem as any)?.createdAt
          ? new Date((lastItem as any).createdAt).getTime().toString()
          : null;

      return new CursorPageResponse(
        plainToInstance(NotificationResponseDto, items),
        nextCursor,
        hasNext,
      );
    }

    await this.redis.set(emptyKey, '1', 'EX', this.emptyCacheTtl);
    return new CursorPageResponse([], null, false);
  }

  async markRead(id: string) {
    const doc = await this.notificationModel.findByIdAndUpdate(
      id,
      { status: 'read' },
      { new: true },
    );
    if (doc) {
      await this.updateNotificationCache(doc);
    }
    return plainToInstance(NotificationResponseDto, doc, {});
  }

  async markAllRead(userId: string) {
    const result = await this.notificationModel.updateMany(
      { userId, status: { $ne: 'read' } },
      { status: 'read', updatedAt: new Date() },
    );
    await this.refreshUserCache(userId);
    return { modifiedCount: result.modifiedCount };
  }

  async removeById(id: string) {
    const doc = await this.notificationModel.findByIdAndDelete(id);
    if (!doc) {
      return;
    }

    const { key, dataKey, emptyKey } = this.getCacheKeys(doc.userId);
    const multi = this.redis.multi();
    multi.zrem(key, id);
    multi.hdel(dataKey, id);
    multi.del(emptyKey);
    await multi.exec();
  }

  async removeAll(userId: string) {
    await this.notificationModel.deleteMany({ userId });
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const multi = this.redis.multi();
    multi.del(key, dataKey, emptyKey);
    await multi.exec();
  }

  private async sendPushNotification(doc: NotificationDocument) {
    const deviceTokens = await this.deviceTokenService.getActiveTokensByUserId(
      doc.userId,
    );

    if (deviceTokens.length === 0) {
      this.logger.warn(`No device tokens found for user ${doc.userId}`);
      return;
    }

    const tokens = deviceTokens.map((deviceToken) => deviceToken.token);
    const renderedTemplate = this.templateService.renderTemplate(
      doc.type,
      doc.payload as any,
    );
    const result = await this.firebaseService.sendToMultipleDevices(
      tokens,
      renderedTemplate.title,
      renderedTemplate.body || doc.message || 'Bạn có thông báo mới',
      {
        notificationId: (doc._id as Types.ObjectId).toString(),
        type: doc.type,
        userId: doc.userId,
        ...renderedTemplate.data,
      },
      {
        androidChannelId: renderedTemplate.delivery.androidChannelId,
      },
    );

    this.logger.log(
      `FCM sent to ${result.successCount}/${tokens.length} devices for user ${doc.userId}`,
    );

    if (result.invalidTokens.length > 0) {
      await this.deviceTokenService.markTokensAsInvalid(result.invalidTokens);
      this.logger.warn(
        `Marked ${result.invalidTokens.length} invalid tokens as inactive`,
      );
    }
  }

  private async cacheNotifications(userId: string, items: any[]) {
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const multi = this.redis.multi();
    const ttlSeconds = this.cacheTtlSeconds();

    for (const item of items) {
      const member = item._id.toString();
      const score = (item as any).createdAt
        ? new Date((item as any).createdAt).getTime()
        : Date.now();
      multi.zadd(key, score, member);
      multi.hset(dataKey, member, JSON.stringify(item));
    }

    multi.zremrangebyrank(key, 0, -101);
    multi.expire(key, ttlSeconds);
    multi.expire(dataKey, ttlSeconds);
    multi.del(emptyKey);
    await multi.exec();
  }

  private async updateNotificationCache(doc: NotificationDocument) {
    const { key, dataKey, emptyKey } = this.getCacheKeys(doc.userId);
    const member = (doc._id as unknown as ObjectId).toString();
    const score = (doc as any).createdAt
      ? new Date((doc as any).createdAt).getTime()
      : Date.now();
    const ttlSeconds = this.cacheTtlSeconds();

    const multi = this.redis.multi();
    multi.del(emptyKey);
    multi.zadd(key, score, member);
    multi.hset(dataKey, member, JSON.stringify(doc.toObject()));
    multi.zremrangebyrank(key, 0, -101);
    multi.expire(key, ttlSeconds);
    multi.expire(dataKey, ttlSeconds);
    await multi.exec();
  }

  private async refreshUserCache(userId: string) {
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const ttlSeconds = this.cacheTtlSeconds();
    const suffix = Date.now().toString();
    const tempKey = `${key}:tmp:${suffix}`;
    const tempDataKey = `${dataKey}:tmp:${suffix}`;

    const items = await this.notificationModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const multi = this.redis.multi();
    if (items.length > 0) {
      for (const item of items) {
        const member = item._id.toString();
        const score = (item as any).createdAt
          ? new Date((item as any).createdAt).getTime()
          : Date.now();
        multi.zadd(tempKey, score, member);
        multi.hset(tempDataKey, member, JSON.stringify(item));
      }
      multi.zremrangebyrank(tempKey, 0, -101);
      multi.expire(tempKey, ttlSeconds);
      multi.expire(tempDataKey, ttlSeconds);
      multi.rename(tempKey, key);
      multi.rename(tempDataKey, dataKey);
      multi.del(emptyKey);
    } else {
      multi.del(key, dataKey);
      multi.set(emptyKey, '1', 'EX', this.emptyCacheTtl);
    }

    await multi.exec();
  }

  private async refreshNotificationsCache(
    userId: string,
    cursor: string | null,
    limit: number,
  ) {
    const scoreFilter = cursor
      ? { $lt: new Date(parseInt(cursor, 10)) }
      : {};

    const dbItems = await this.notificationModel
      .find({ userId, ...(cursor ? { createdAt: scoreFilter } : {}) })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    if (!dbItems.length) {
      return;
    }

    await this.cacheNotifications(userId, dbItems);
  }

  private getCacheKeys(userId: string) {
    const key = `user:${userId}:notifications`;
    return {
      key,
      dataKey: `${key}:data`,
      emptyKey: `${key}:empty`,
    };
  }

  private cacheTtlSeconds() {
    return this.notifCacheTtl + Math.floor(Math.random() * 300);
  }
}
