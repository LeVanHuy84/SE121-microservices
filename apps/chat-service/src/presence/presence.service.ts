import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RedisPubSubService } from '@repo/common';

const CMD_CONNECT = 'chat_gateway.connect';
const CMD_HEARTBEAT = 'chat_gateway.heartbeat';
const CMD_DISCONNECT = 'chat_gateway.disconnect';
const CH_ONLINE = 'presence.online';
const CH_OFFLINE = 'presence.offline';
const SCAN_LOCK_KEY = 'presence:scan:lock';

const PRESENCE_KEY = (u: string) => `presence:user:${u}`;
const SOCKETS_KEY = (u: string) => `presence:user:${u}:sockets`;

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);

  private readonly ONLINE_THRESHOLD_MS =
    Number(process.env.ONLINE_THRESHOLD_MS) || 5000;
  private readonly PRESENCE_KEY_TTL =
    Number(process.env.PRESENCE_KEY_TTL) || 36000;
  private readonly DISCONNECT_GRACE_MS =
    Number(process.env.PRESENCE_DISCONNECT_GRACE_MS) || 5000;
  private readonly SCAN_BATCH = Number(process.env.PRESENCE_SCAN_BATCH) || 200;
  private readonly SCAN_LOCK_TTL_MS =
    Number(process.env.PRESENCE_SCAN_LOCK_TTL_MS) || 25_000;

  private disconnectTimers = new Map<string, NodeJS.Timeout>();
  private running = true;

  constructor(
    @Inject('REDIS_PRESENCE') private readonly redis: RedisPubSubService,
  ) {}

  async onModuleInit() {
    await this.redis.subscribe(CMD_CONNECT, (raw) => this.handleConnect(raw));
    await this.redis.subscribe(CMD_HEARTBEAT, (raw) =>
      this.handleHeartbeat(raw),
    );
    await this.redis.subscribe(CMD_DISCONNECT, (raw) =>
      this.handleDisconnect(raw),
    );

    this.logger.log('PresenceService subscribed to command channels');
  }

  async onModuleDestroy() {
    this.running = false;
    for (const t of this.disconnectTimers.values()) clearTimeout(t);
    this.disconnectTimers.clear();
  }

  // ---------- command handlers ----------
  private async handleConnect(raw: string) {
    try {
      const { userId, serverId, socketId, now } = JSON.parse(raw);
      await this._markConnected(userId, serverId, socketId, now ?? Date.now());
    } catch (err) {
      this.logger.warn('Invalid connect command', err);
    }
  }

  private async handleHeartbeat(raw: string) {
    try {
      const { userId, now } = JSON.parse(raw);
      await this._heartbeat(userId, now ?? Date.now());
    } catch (err) {
      this.logger.warn('Invalid heartbeat command', err);
    }
  }

  private async handleDisconnect(raw: string) {
    try {
      const { userId, serverId, socketId, now } = JSON.parse(raw);
      await this._scheduleDisconnect(
        userId,
        serverId,
        socketId,
        now ?? Date.now(),
      );
    } catch (err) {
      this.logger.warn('Invalid disconnect command', err);
    }
  }

  // ---------- internal implementations ----------
  private async _markConnected(
    userId: string,
    serverId: string,
    socketId: string,
    now: number,
  ) {
    if (!userId) return;
    const pKey = PRESENCE_KEY(userId);
    const sKey = SOCKETS_KEY(userId);

    // cancel any disconnect timer for this socket
    this._clearDisconnectTimer(userId, socketId);

    // add socket and refresh TTLs
    const pipe = this.redis.pipeline();
    pipe.sadd(sKey, socketId);
    pipe.expire(pKey, this.PRESENCE_KEY_TTL);
    pipe.expire(sKey, this.PRESENCE_KEY_TTL);
    await pipe.exec();

    // update hash fields (server + last_active)
    if (this.redis.hset) {
      await this.redis.hset(
        pKey,
        'server',
        serverId,
        'last_active',
        String(now),
      );
    } else if (this.redis.baseClient?.hset) {
      await this.redis.baseClient.hset(
        pKey,
        'server',
        serverId,
        'last_active',
        String(now),
      );
    } else {
      await this.redis.set(
        `${pKey}:last_active`,
        String(now),
        this.PRESENCE_KEY_TTL,
      );
    }

    // publish online only if status changes
    const prevStatus = await this._getStatus(pKey);
    if (prevStatus !== 'ONLINE') {
      await this._setStatus(pKey, 'ONLINE');
      await this._publishOnline(userId, now, serverId);
    }
  }

  private async _heartbeat(userId: string, now: number) {
    if (!userId) return;
    const pKey = PRESENCE_KEY(userId);
    if (this.redis.hset) {
      await this.redis.hset(pKey, 'last_active', String(now));
    } else if (this.redis.baseClient?.hset) {
      await this.redis.baseClient.hset(pKey, 'last_active', String(now));
    } else {
      await this.redis.set(
        `${pKey}:last_active`,
        String(now),
        this.PRESENCE_KEY_TTL,
      );
    }
    await this.redis.expire(pKey, this.PRESENCE_KEY_TTL);
    // do not publish on every heartbeat to avoid spam; presence is derived
  }

  private async _scheduleDisconnect(
    userId: string,
    serverId: string,
    socketId: string,
    now: number,
  ) {
    if (!userId) return;
    const sKey = SOCKETS_KEY(userId);

    // remove socket immediately
    await this.redis.srem(sKey, socketId).catch(() => {});

    // schedule offline check after grace window
    const timerKey = `${userId}:${socketId}`;
    this._clearDisconnectTimer(userId, socketId);

    const t = setTimeout(async () => {
      try {
        const remaining = await this.redis.scard(sKey);
        const pKey = PRESENCE_KEY(userId);

        let lastActive: string | null = null;
        if (this.redis.hget)
          lastActive = await this.redis.hget(pKey, 'last_active');
        else if (this.redis.baseClient?.hget)
          lastActive = await this.redis.baseClient.hget(pKey, 'last_active');
        else lastActive = await this.redis.get(`${pKey}:last_active`);

        if (
          Number(remaining) === 0 ||
          !lastActive ||
          Date.now() - Number(lastActive) > this.ONLINE_THRESHOLD_MS
        ) {
          // mark offline and cleanup
          await this.redis.pipeline().del(pKey, sKey).exec();
          await this._setStatus(pKey, 'OFFLINE');
          await this._publishOffline(
            userId,
            lastActive ? Number(lastActive) : 0,
            serverId,
            'disconnect_grace',
          );
        }
      } catch (err) {
        this.logger.error('disconnect grace handler error', err);
      } finally {
        this.disconnectTimers.delete(timerKey);
      }
    }, this.DISCONNECT_GRACE_MS);

    this.disconnectTimers.set(timerKey, t);
  }

  // @Cron(CronExpression.EVERY_30_SECONDS) // every 30 seconds
  async scanZombiesCron() {
    const lockVal = `${process.pid}-${Date.now()}`;
    try {
      const ok = await this.redis.baseClient.set(
        SCAN_LOCK_KEY,
        lockVal,
        'PX',
        this.SCAN_LOCK_TTL_MS,
      );
      if (ok !== 'OK') return; // another instance runs
    } catch (err) {
      this.logger.warn('scan lock acquire failed', err);
      return;
    }

    this.logger.debug('scanZombiesCron acquired lock and started scanning');
    try {
      const stream = this.redis.scanStream(`presence:user:*`, this.SCAN_BATCH);
      for await (const keys of stream) {
        if (!keys?.length) continue;
        const perKeyPipe = this.redis.pipeline();
        for (const key of keys) {
          perKeyPipe.hget(key, 'last_active');
          perKeyPipe.scard(`${key}:sockets`);
        }
        const results = await perKeyPipe.exec();
        if (!results) continue;
        for (let i = 0; i < results.length; i += 2) {
          const last = results[i]?.[1];
          const scard = Number(results[i + 1]?.[1] ?? 0);
          const key = keys[i / 2];
          const userId = key.split(':')[2];
          if (
            !last ||
            (Date.now() - Number(last) > this.ONLINE_THRESHOLD_MS &&
              scard === 0)
          ) {
            await this.redis.pipeline().del(key, `${key}:sockets`).exec();
            await this._setStatus(key, 'OFFLINE');
            await this._publishOffline(
              userId,
              last ? Number(last) : 0,
              undefined,
              'zombie_scan',
            );
          }
        }
      }
    } catch (err) {
      this.logger.error('scanZombiesCron error', err);
    } finally {
      // release lock safely via Lua script to delete only if owner
      const lua = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.baseClient.eval(lua, 1, SCAN_LOCK_KEY, lockVal);
      } catch (e) {
        this.logger.warn('release lock failed', e);
      }
    }
  }

  // ---------- helpers ----------
  private async _getStatus(pKeyOrKey: string) {
    try {
      const pKey = pKeyOrKey.startsWith('presence:user:')
        ? pKeyOrKey
        : PRESENCE_KEY(pKeyOrKey);
      if (this.redis.hget)
        return (await this.redis.hget(pKey, 'status')) ?? null;
      if (this.redis.baseClient?.hget)
        return (await this.redis.baseClient.hget(pKey, 'status')) ?? null;
      return null;
    } catch {
      return null;
    }
  }

  private async _setStatus(pKeyOrKey: string, status: 'ONLINE' | 'OFFLINE') {
    try {
      const pKey = pKeyOrKey.startsWith('presence:user:')
        ? pKeyOrKey
        : PRESENCE_KEY(pKeyOrKey);
      if (this.redis.hset) await this.redis.hset(pKey, 'status', status);
      else if (this.redis.baseClient?.hset)
        await this.redis.baseClient.hset(pKey, 'status', status);
    } catch (err) {
      this.logger.warn('setStatus failed', err);
    }
  }

  private async _publishOnline(
    userId: string,
    lastActive: number,
    serverId?: string,
  ) {
    const payload = { userId, lastActive, serverId, timestamp: Date.now() };
    await this.redis.publish(CH_ONLINE, JSON.stringify(payload));
    this.logger.debug('Published presence.online', payload);
  }

  private async _publishOffline(
    userId: string,
    lastActive: number,
    serverId?: string,
    reason?: string,
  ) {
    const payload = {
      userId,
      lastActive,
      serverId,
      reason,
      timestamp: Date.now(),
    };
    await this.redis.publish(CH_OFFLINE, JSON.stringify(payload));
    this.logger.debug('Published presence.offline', payload);
  }

  private _clearDisconnectTimer(userId: string, socketId: string) {
    const k = `${userId}:${socketId}`;
    const t = this.disconnectTimers.get(k);
    if (t) {
      clearTimeout(t);
      this.disconnectTimers.delete(k);
    }
  }
}
