import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateNotificationDto,
  CursorPageResponse,
  CursorPaginationDTO,
  GetNotificationQueryDto,
  NotificationResponseDto,
} from '@repo/dtos';
import type { Queue } from 'bull';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Model, ObjectId, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from 'src/mongo/schema/notification.schema';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationPolicyService } from './services/notification-policy.service';
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
    private readonly policyService: NotificationPolicyService,
    private readonly dispatcherService: NotificationDispatcherService,
    @InjectRedis()
    private readonly redis: Redis,
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

    const policyResult = await this.policyService.evaluatePolicy(dto.userId, dto.type);

    if (!policyResult.allowed) {
      if (policyResult.suppressed) {
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
      } else {
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
            rateLimitReason: policyResult.reason,
            dailyCount: policyResult.dailyCount,
            burstCount: policyResult.burstCount,
          },
        });
      }
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
        channels: [], // Deprecated, we no longer store allowedChannels here
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

      await this.dispatcherService.dispatchToQueue(doc as any, sendAt);

      return doc;
    } catch (error) {
      await this.policyService.releaseSlot(dto.userId, dto.type);
      throw error;
    }
  }

  async findById(id: string) {
    const doc = await this.notificationModel.findById(id).lean();
    return plainToInstance(NotificationResponseDto, doc, {});
  }

  async findByUser(
    userId: string,
    query: GetNotificationQueryDto,
  ): Promise<CursorPageResponse<NotificationResponseDto>> {
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const limit = query.limit;
    const hasFilters = query.type !== undefined || query.isRead !== undefined;

    if (!hasFilters) {
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

    }

    const mongoQuery: any = { userId };
    if (query.cursor) {
      mongoQuery.createdAt = { $lt: new Date(parseInt(query.cursor, 10)) };
    }
    if (query.type) {
      mongoQuery.type = query.type;
    }
    if (query.isRead !== undefined) {
      mongoQuery.status = query.isRead ? 'read' : 'unread';
    }

    const dbItems = await this.notificationModel
      .find(mongoQuery)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();

    if (dbItems.length > 0) {
      if (!hasFilters) {
        await this.cacheNotifications(userId, dbItems);
      }

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

    if (!hasFilters) {
      await this.redis.set(emptyKey, '1', 'EX', this.emptyCacheTtl);
    }
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
      return { success: true };
    }

    const { key, dataKey, emptyKey } = this.getCacheKeys(doc.userId);
    const multi = this.redis.multi();
    multi.zrem(key, id);
    multi.hdel(dataKey, id);
    multi.del(emptyKey);
    await multi.exec();
    return { success: true };
  }

  async removeAll(userId: string) {
    await this.notificationModel.deleteMany({ userId });
    const { key, dataKey, emptyKey } = this.getCacheKeys(userId);
    const multi = this.redis.multi();
    multi.del(key, dataKey, emptyKey);
    await multi.exec();
    return { success: true };
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
