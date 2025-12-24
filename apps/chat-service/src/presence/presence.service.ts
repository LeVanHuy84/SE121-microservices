import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PresenceHeartbeatEvent,
  PresenceInfo,
  PresenceStatus,
  PresenceUpdateEvent,
} from '@repo/dtos';
import Redis from 'ioredis';

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);

  private sub: Redis; // subscriber cho presence:heartbeat

  // config
  private readonly OFFLINE_THRESHOLD_MS = Number(
    process.env.PRESENCE_OFFLINE_THRESHOLD_MS ?? 45_000,
  );
  private readonly PRESENCE_HASH_TTL_SECONDS = Math.ceil(
    this.OFFLINE_THRESHOLD_MS / 1000 + 45,
  );

  private readonly lastSeenZSetKey = 'presence:lastSeen';
  private readonly onlineSetKey = 'presence:online';

  // key dạng: user-location:{userId} -> serverId
  private userLocationKey(userId: string) {
    return `user-location:${userId}`;
  }

  private userKey(userId: string) {
    return `presence:user:${userId}`;
  }

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ========== Life cycle ==========

  async onModuleInit() {
    this.sub = this.redis.duplicate();

    await this.sub.subscribe('presence:heartbeat');
    this.sub.on('message', (channel, message) => {
      if (channel !== 'presence:heartbeat') return;
      this.handleHeartbeatMessage(message).catch((err) =>
        this.logger.error('Error handling heartbeat', err),
      );
    });
  }

  async onModuleDestroy() {
    if (this.sub) {
      this.sub.removeAllListeners();
      this.sub.disconnect();
    }
  }

  // ========== Handle HEARTBEAT từ gateway ==========

  private async handleHeartbeatMessage(raw: string) {
    let evt: PresenceHeartbeatEvent;
    try {
      evt = JSON.parse(raw);
    } catch (e) {
      this.logger.error('Invalid heartbeat message', e);
      return;
    }

    if (evt.type !== 'HEARTBEAT') return;

    const { userId, ts, serverId } = evt;
    const now = ts || Date.now();

    const userKey = this.userKey(userId);
    const currentStatus = await this.redis.hget(userKey, 'status');
    const wasOnline = currentStatus === 'online';

    // TTL cho user-location (phải > offline threshold chút)
    const locationTtlSeconds = Math.ceil(this.OFFLINE_THRESHOLD_MS / 1000 + 15);

    // cập nhật lastSeen + status online + serverId + user-location
    const pipeline = this.redis.pipeline();
    pipeline.hmset(userKey, {
      status: 'online',
      lastSeen: String(now),
      lastServerId: serverId || '',
    });
    pipeline.expire(userKey, this.PRESENCE_HASH_TTL_SECONDS);
    pipeline.zadd(this.lastSeenZSetKey, now, userId);
    pipeline.sadd(this.onlineSetKey, userId);
    if (serverId) {
      pipeline.set(
        this.userLocationKey(userId),
        serverId,
        'EX',
        locationTtlSeconds,
      );
    }
    await pipeline.exec();

    if (!wasOnline) {
      // offline -> online
      await this.publishPresenceUpdate({
        type: 'PRESENCE_UPDATE',
        userId,
        status: 'online',
        lastSeen: now,
      });
    }
  }

  // ========== Zombie sweep dùng Schedule ==========

  @Cron(CronExpression.EVERY_30_SECONDS)
  async sweepZombies() {
    const now = Date.now();
    const cutoff = now - this.OFFLINE_THRESHOLD_MS;

    // lấy user có lastSeen <= cutoff
    const staleUsers = await this.redis.zrangebyscore(
      this.lastSeenZSetKey,
      '-inf',
      cutoff,
    );

    if (!staleUsers.length) return;

    this.logger.debug(
      `Zombie sweep: ${staleUsers.length} stale users (cutoff=${cutoff})`,
    );

    for (const userId of staleUsers) {
      const userKey = this.userKey(userId);
      const data = await this.redis.hgetall(userKey);

      const status = (data?.status as PresenceStatus) || 'offline';
      const lastSeen = data?.lastSeen ? Number(data.lastSeen) : cutoff;

      if (status === 'online') {
        // mark offline
        const pipeline = this.redis.pipeline();
        pipeline.hmset(userKey, {
          status: 'offline',
          lastSeen: String(lastSeen),
        });
        pipeline.srem(this.onlineSetKey, userId);
        pipeline.zrem(this.lastSeenZSetKey, userId);
        // xoá luôn user-location -> coi như user không còn gắn với server nào
        pipeline.del(this.userLocationKey(userId));
        await pipeline.exec();

        await this.publishPresenceUpdate({
          type: 'PRESENCE_UPDATE',
          userId,
          status: 'offline',
          lastSeen,
        });

        this.logger.debug(
          `User ${userId} marked offline by zombie sweep (lastSeen=${lastSeen})`,
        );
      } else {
        // đã offline rồi thì chỉ cần dọn zset để không quét lại
        await this.redis.zrem(this.lastSeenZSetKey, userId);
      }
    }
  }

  // ========== Helper publish update ra Redis cho gateway ==========

  private async publishPresenceUpdate(evt: PresenceUpdateEvent) {
    await this.redis.publish('presence:updates', JSON.stringify(evt));
  }

  // ========== API nội bộ: lấy presence cho list user ==========

  async getPresenceForUsers(
    userIds: string[],
  ): Promise<Record<string, PresenceInfo>> {
    if (!userIds.length) return {};

    const pipeline = this.redis.pipeline();
    userIds.forEach((id) => pipeline.hgetall(this.userKey(id)));

    const results = await pipeline.exec();

    const map: Record<string, PresenceInfo> = {};

    if (!results) return map;

    userIds.forEach((id, idx) => {
      const [, data] = results[idx] as [Error | null, any];
      const status =
        data && data.status ? (data.status as PresenceStatus) : 'offline';
      const lastSeen = data && data.lastSeen ? Number(data.lastSeen) : null;
      const serverId = data && data.lastServerId ? data.lastServerId : null;

      map[id] = { status, lastSeen, serverId };
    });

    return map;
  }

  // Optional: cho admin/debug
  async getOnlineUsers(limit = 1000): Promise<string[]> {
    const members = await this.redis.smembers(this.onlineSetKey);
    return members.slice(0, limit);
  }
}
