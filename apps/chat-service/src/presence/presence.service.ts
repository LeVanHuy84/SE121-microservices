import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  PresenceDisconnectEvent,
  PresenceHeartbeatEvent,
  PresenceInfo,
  PresenceStatus,
  PresenceUpdateEvent,
} from '@repo/dtos';
import Redis from 'ioredis';

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly presenceEventsChannel = 'presence:events';
  private readonly presenceUpdatesChannel = 'presence:updates';
  private readonly markOfflineIfStaleScript = `
    local userKey = KEYS[1]
    local zKey = KEYS[2]
    local onlineKey = KEYS[3]
    local locationKey = KEYS[4]
    local connSetKey = KEYS[5]
    local cutoff = tonumber(ARGV[1])
    local userId = ARGV[2]
    local connKeyPrefix = ARGV[3]

    local lastSeenStr = redis.call('HGET', userKey, 'lastSeen')
    local status = redis.call('HGET', userKey, 'status')
    local lastSeen = tonumber(lastSeenStr) or cutoff

    if lastSeenStr and lastSeen > cutoff then
      return {0, lastSeen}
    end

    local active = 0
    if connSetKey then
      local conns = redis.call('SMEMBERS', connSetKey)
      for i = 1, #conns do
        local connId = conns[i]
        local connKey = connKeyPrefix .. connId
        if redis.call('EXISTS', connKey) == 1 then
          active = active + 1
        else
          redis.call('SREM', connSetKey, connId)
        end
      end
    end

    if active > 0 then
      if status ~= 'online' then
        redis.call('HSET', userKey, 'status', 'online', 'lastSeen', tostring(lastSeen))
        redis.call('SADD', onlineKey, userId)
      end
      return {0, lastSeen}
    end

    if status == 'online' then
      redis.call('HSET', userKey, 'status', 'offline', 'lastSeen', tostring(lastSeen))
      redis.call('SREM', onlineKey, userId)
      redis.call('ZREM', zKey, userId)
      redis.call('DEL', locationKey)
      return {1, lastSeen}
    end

    redis.call('ZREM', zKey, userId)
    return {0, lastSeen}
  `;
  private readonly markOfflineOnDisconnectScript = `
    local userKey = KEYS[1]
    local zKey = KEYS[2]
    local onlineKey = KEYS[3]
    local locationKey = KEYS[4]
    local connSetKey = KEYS[5]
    local now = tonumber(ARGV[1])
    local userId = ARGV[2]
    local disconnectedConnId = ARGV[3]
    local connKeyPrefix = ARGV[4]

    if disconnectedConnId and disconnectedConnId ~= '' then
      redis.call('DEL', connKeyPrefix .. disconnectedConnId)
      redis.call('SREM', connSetKey, disconnectedConnId)
    end

    local conns = redis.call('SMEMBERS', connSetKey)
    local active = 0
    for i = 1, #conns do
      local connId = conns[i]
      local connKey = connKeyPrefix .. connId
      if redis.call('EXISTS', connKey) == 1 then
        active = active + 1
      else
        redis.call('SREM', connSetKey, connId)
      end
    end

    if active > 0 then
      return {0, tonumber(redis.call('HGET', userKey, 'lastSeen')) or now}
    end

    redis.call('DEL', connSetKey)

    local status = redis.call('HGET', userKey, 'status')
    if status == 'online' then
      redis.call('HSET', userKey, 'status', 'offline', 'lastSeen', tostring(now))
      redis.call('SREM', onlineKey, userId)
      redis.call('ZREM', zKey, userId)
      redis.call('DEL', locationKey)
      return {1, now}
    end

    redis.call('ZREM', zKey, userId)
    return {0, tonumber(redis.call('HGET', userKey, 'lastSeen')) or now}
  `;

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

  private userConnSetKey(userId: string) {
    return `presence:user:${userId}:conns`;
  }

  private connKey(userId: string, connectionId: string) {
    return `presence:conn:${userId}:${connectionId}`;
  }

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ========== Life cycle ==========

  async onModuleInit() {
    this.sub = this.redis.duplicate();

    await this.sub.subscribe(this.presenceEventsChannel);
    this.sub.on('message', (channel, message) => {
      if (channel !== this.presenceEventsChannel) return;
      this.handlePresenceEventMessage(message).catch((err) =>
        this.logger.error('Error handling presence event', err),
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

  private async handlePresenceEventMessage(raw: string) {
    let evt: PresenceHeartbeatEvent | PresenceDisconnectEvent;
    try {
      evt = JSON.parse(raw);
    } catch (e) {
      this.logger.error('Invalid presence event message', e);
      return;
    }

    if (evt.type === 'HEARTBEAT') {
      await this.handleHeartbeatEvent(evt);
      return;
    }

    if (evt.type === 'DISCONNECT') {
      await this.handleDisconnectEvent(evt);
    }
  }

  private async handleHeartbeatEvent(evt: PresenceHeartbeatEvent) {
    const { userId, ts, serverId, connectionId } = evt;
    if (!userId) return;

    const now = ts ?? Date.now();

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
    if (connectionId) {
      const connTtlSeconds = Math.ceil(this.OFFLINE_THRESHOLD_MS / 1000 + 15);
      pipeline.set(
        this.connKey(userId, connectionId),
        String(now),
        'EX',
        connTtlSeconds,
      );
      pipeline.sadd(this.userConnSetKey(userId), connectionId);
      pipeline.expire(this.userConnSetKey(userId), connTtlSeconds);
    }
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

  private async handleDisconnectEvent(evt: PresenceDisconnectEvent) {
    const { userId, connectionId, ts } = evt;
    if (!userId || !connectionId) return;

    const now = ts ?? Date.now();
    const res = (await this.redis.eval(
      this.markOfflineOnDisconnectScript,
      5,
      this.userKey(userId),
      this.lastSeenZSetKey,
      this.onlineSetKey,
      this.userLocationKey(userId),
      this.userConnSetKey(userId),
      String(now),
      userId,
      connectionId,
      `presence:conn:${userId}:`,
    )) as [number, number] | number;

    const flag = Array.isArray(res) ? Number(res[0]) : Number(res);
    const lastSeen = Array.isArray(res) ? Number(res[1]) : now;

    if (flag === 1) {
      await this.publishPresenceUpdate({
        type: 'PRESENCE_UPDATE',
        userId,
        status: 'offline',
        lastSeen,
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
      const res = (await this.redis.eval(
        this.markOfflineIfStaleScript,
        5,
        this.userKey(userId),
        this.lastSeenZSetKey,
        this.onlineSetKey,
        this.userLocationKey(userId),
        this.userConnSetKey(userId),
        String(cutoff),
        userId,
        `presence:conn:${userId}:`,
      )) as [number, number] | number;

      const flag = Array.isArray(res) ? Number(res[0]) : Number(res);
      const lastSeen = Array.isArray(res) ? Number(res[1]) : cutoff;

      if (flag === 1) {
        await this.publishPresenceUpdate({
          type: 'PRESENCE_UPDATE',
          userId,
          status: 'offline',
          lastSeen,
        });

        this.logger.debug(
          `User ${userId} marked offline by zombie sweep (lastSeen=${lastSeen})`,
        );
      }
    }
  }
  // ========== Helper publish update ra Redis cho gateway ==========

  private async publishPresenceUpdate(evt: PresenceUpdateEvent) {
    await this.redis.publish(this.presenceUpdatesChannel, JSON.stringify(evt));
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
