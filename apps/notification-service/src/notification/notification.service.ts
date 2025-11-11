import { InjectRedis } from '@nestjs-modules/ioredis';
import { InjectQueue } from '@nestjs/bull';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  CreateNotificationDto,
  CursorPageResponse,
  CursorPaginationDTO,
  CursorPaginationResponseDTO,
  NotificationResponseDto,
  PageResponse,
  PaginationDTO,
} from '@repo/dtos';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { Queue } from 'bull';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';
import { Cursor, Model, ObjectId } from 'mongoose';
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
    // 1️⃣ Check trùng requestId
    if (dto.requestId) {
      const exists = await this.notificationModel
        .findOne({ requestId: dto.requestId })
        .lean();
      if (exists) return plainToInstance(NotificationResponseDto, exists, {});
    }

    // 2️⃣ Get user preference và rate-limit
    const prefs = await this.userPreferenceService.getUserPreferences(
      dto.userId
    );
    const allowedChannels =
      dto.channels && dto.channels.length
        ? dto.channels.filter((ch) => prefs.allowedChannels.includes(ch))
        : prefs.allowedChannels;

    if (!allowedChannels || allowedChannels.length === 0) {
      this.logger.warn(`User ${dto.userId} has no allowed channels — skipping`);
      const suppressed = await this.notificationModel.create({
        requestId: dto.requestId,
        userId: dto.userId,
        type: dto.type,
        payload: dto.payload,
        message: null,
        channels: [],
        status: 'unread',
        meta: { suppressed: true },
      });
      return suppressed;
    }

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
        message: null,
        channels: [],
        status: 'unread',
        meta: { rateLimited: true },
      });
      return blocked;
    }

    // 3️⃣ Render message trước khi lưu DB
    const renderedMessage = this.templateService.render(dto.type, dto.payload);

    const sendAt = dto.sendAt ? new Date(dto.sendAt) : undefined;

    // 4️⃣ Lưu notification vào DB, đã có message
    const doc = await this.notificationModel.create({
      requestId: dto.requestId,
      userId: dto.userId,
      type: dto.type,
      payload: dto.payload,
      message: renderedMessage,
      channels: allowedChannels,
      sendAt,
      status: 'unread',
      meta: dto.meta || {},
    });

    // 5️⃣ Schedule hoặc gửi ngay
    if (sendAt && sendAt.getTime() > Date.now()) {
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
      try {
        await Promise.all([
          this.publishToChannels(doc),
          this.cacheNotifications(doc.userId, [doc]),
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
    const basePayload = plainToInstance(
      NotificationResponseDto,
      doc.toObject(),
      {}
    );

    // ensure maxRetries in meta
    const maxRetries = doc.meta?.maxRetries ?? this.defaultMaxRetries;

    for (const ch of doc.channels) {
      const routingKey = `channel.${ch}`; // e.g. channel.inapp, channel.email
      const headers = {
        'x-request-id': doc.requestId || (doc._id as ObjectId).toString(),
        'x-retries': 0,
        'x-max-retries':
          doc.meta?.maxRetries === 0
            ? maxRetries
            : doc.meta?.maxRetries || maxRetries,
      };
      await this.rabbitChannel.publish(
        'notification', // đổi từ notification_exchange thành 'notification'
        routingKey,
        basePayload,
        {
          persistent: true,
          contentType: 'application/json',
          headers,
        }
      );
      this.logger.log(`Published notification ${doc._id} -> ${routingKey}`);
    }
  }
  async findById(id: string) {
    const doc = await this.notificationModel.findById(id).lean();
    return plainToInstance(NotificationResponseDto, doc, {});
  }

 // ==================== Find ====================
async findByUser(
  userId: string,
  query: CursorPaginationDTO
): Promise<CursorPageResponse<NotificationResponseDto>> {
  const key = `user:${userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;
  const limit = query.limit;

  // Check sentinel key
  const isEmpty = await this.redis.exists(emptyKey);
  if (isEmpty) {
    return new CursorPageResponse<NotificationResponseDto>([], null, false);
  }

  // Xác định max score cho cursor
  let maxScore = '+inf';
  if (query.cursor) maxScore = `(${query.cursor}`;

  // Lấy member từ ZSET
  const ids = await this.redis.zrevrangebyscore(
    key,
    maxScore,
    '-inf',
    'LIMIT',
    0,
    limit + 1
  );

  if (ids.length > 0) {
    const hasNext = ids.length > limit;
    const selectedIds = ids.slice(0, limit);

    // Lấy dữ liệu JSON từ hash
    const cached = await this.redis.hmget(dataKey, ...selectedIds);
    const items = cached
      .filter((c): c is string => c !== null)
      .map((c) => JSON.parse(c));

    const lastItem = items.length > 0 ? items[items.length - 1] : null;
    const nextCursor =
      hasNext && lastItem?.createdAt
        ? new Date(lastItem.createdAt).getTime().toString()
        : null;

    return new CursorPageResponse(
      plainToInstance(NotificationResponseDto, items),
      nextCursor,
      hasNext
    );
  }

  // Nếu cache rỗng, lấy DB
  const scoreFilter = query.cursor
    ? { $lt: new Date(parseInt(query.cursor)) }
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
      hasNext
    );
  }

  // DB rỗng → set sentinel key
  await this.redis.set(emptyKey, '1', 'EX', 60);
  return new CursorPageResponse([], null, false);
}

// ==================== Mark Read ====================
async markRead(id: string) {
  const doc = await this.notificationModel.findByIdAndUpdate(
    id,
    { status: 'read' },
    { new: true }
  );
  if (doc) await this.updateNotificationCache(doc);
  return plainToInstance(NotificationResponseDto, doc, {});
}

async markAllRead(userId: string) {
  const result = await this.notificationModel.updateMany(
    { userId, status: { $ne: 'read' } },
    { status: 'read', updatedAt: new Date() }
  );
  await this.refreshUserCache(userId);
  return { modifiedCount: result.modifiedCount };
}

// ==================== Delete ====================
async removeById(id: string) {
  const doc = await this.notificationModel.findByIdAndDelete(id);
  if (!doc) return;
  const key = `user:${doc.userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;

  await this.redis.pipeline()
    .zrem(key, id)
    .hdel(dataKey, id)
    .del(emptyKey)
    .exec();
}

async removeAll(userId: string) {
  await this.notificationModel.deleteMany({ userId });
  const key = `user:${userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;
  await this.redis.del(key, dataKey, emptyKey);
}

// ==================== Cache helpers ====================
private async cacheNotifications(userId: string, items: any[]) {
  const key = `user:${userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;
  const pipeline = this.redis.pipeline();

  for (const item of items) {
    const member = item._id.toString();
    const score = item.createdAt ? new Date(item.createdAt).getTime() : Date.now();
    pipeline.zadd(key, score, member);
    pipeline.hset(dataKey, member, JSON.stringify(item));
  }

  pipeline.zremrangebyrank(key, 0, -101);
  pipeline.expire(key, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
  pipeline.expire(dataKey, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
  pipeline.del(emptyKey);

  await pipeline.exec();
}

private async updateNotificationCache(doc: NotificationDocument) {
  const key = `user:${doc.userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;
  const member = (doc._id as ObjectId).toString();
  const score = (doc as any).createdAt ? new Date((doc as any).createdAt).getTime() : Date.now();

  const pipeline = this.redis.pipeline();
  pipeline.del(emptyKey);
  pipeline.zadd(key, score, member);
  pipeline.hset(dataKey, member, JSON.stringify(doc.toObject()));
  pipeline.zremrangebyrank(key, 0, -101);
  pipeline.expire(key, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
  pipeline.expire(dataKey, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
  await pipeline.exec();
}

private async refreshUserCache(userId: string) {
  const key = `user:${userId}:notifications`;
  const dataKey = `${key}:data`;
  const emptyKey = `${key}:empty`;

  const items = await this.notificationModel
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();

  const pipeline = this.redis.pipeline();
  pipeline.del(key, dataKey, emptyKey);

  if (items.length > 0) {
    for (const item of items) {
      const member = item._id.toString();
      const score = (item as any).createdAt ? new Date((item as any).createdAt).getTime() : Date.now();
      pipeline.zadd(key, score, member);
      pipeline.hset(dataKey, member, JSON.stringify(item));
    }
    pipeline.zremrangebyrank(key, 0, -101);
    pipeline.expire(key, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
    pipeline.expire(dataKey, this.NOTIF_CACHE_TTL + Math.floor(Math.random() * 300));
  } else {
    pipeline.set(emptyKey, '1', 'EX', 60);
  }

  await pipeline.exec();
}
}
