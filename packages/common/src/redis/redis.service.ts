// libs/shared-redis/src/redis.service.ts
import { Logger } from '@nestjs/common';
import Redis, { ChainableCommander, Pipeline } from 'ioredis';

type MessageHandler = (msg: string, channel: string) => void;
type PMessageHandler = (pattern: string, channel: string, msg: string) => void;

export class RedisPubSubService {
  private readonly logger = new Logger(RedisPubSubService.name);
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, MessageHandler[]>();
  private pHandlers = new Map<string, PMessageHandler[]>();

  constructor(public readonly baseClient: Redis) {
    this.pub = this.baseClient.duplicate();
    this.sub = this.baseClient.duplicate();

    this.sub.on('message', (channel, message) => {
      const list = this.handlers.get(channel);
      list?.forEach((fn) => fn(message, channel));
    });

    this.sub.on('pmessage', (pattern, channel, message) => {
      const list = this.pHandlers.get(pattern);
      list?.forEach((fn) => fn(pattern, channel, message));
    });
  }

  // =========================
  // 🔔 PUB/SUB
  // =========================
  async publish(channel: string, message: any) {
    const payload =
      typeof message === 'string' ? message : JSON.stringify(message);
    await this.pub.publish(channel, payload);
  }

  async subscribe(channel: string, handler: MessageHandler) {
    if (!this.handlers.has(channel)) {
      await this.sub.subscribe(channel);
      this.handlers.set(channel, []);
    }
    this.handlers.get(channel)!.push(handler);
  }

  async psubscribe(pattern: string, handler: PMessageHandler) {
    if (!this.pHandlers.has(pattern)) {
      await this.sub.psubscribe(pattern);
      this.pHandlers.set(pattern, []);
    }
    this.pHandlers.get(pattern)!.push(handler);
  }

  async unsubscribe(channel: string) {
    await this.sub.unsubscribe(channel);
    this.handlers.delete(channel);
  }

  async punsubscribe(pattern: string) {
    await this.sub.punsubscribe(pattern);
    this.pHandlers.delete(pattern);
  }

  // =========================
  // 💾 DATA OPERATIONS
  // =========================
  async set(key: string, value: any, ttlSeconds?: number) {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    if (ttlSeconds) return this.baseClient.set(key, payload, 'EX', ttlSeconds);
    return this.baseClient.set(key, payload);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const data = await this.baseClient.get(key);
    try {
      return data ? (JSON.parse(data) as T) : null;
    } catch {
      return data as any;
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.baseClient.exists(key)) > 0;
  }

  async ttl(key: string): Promise<number> {
    return await this.baseClient.ttl(key);
  }

  async del(...keys: string[]) {
    return this.baseClient.del(...keys);
  }

  async keys(pattern: string): Promise<string[]> {
    return this.baseClient.keys(pattern);
  }

  async expire(key: string, ttlSeconds: number) {
    return this.baseClient.expire(key, ttlSeconds);
  }

  async sadd(key: string, ...members: string[]) {
    return this.baseClient.sadd(key, ...members);
  }

  async srem(key: string, ...members: string[]) {
    return this.baseClient.srem(key, ...members);
  }

  async smembers(key: string) {
    return this.baseClient.smembers(key);
  }

  async scard(key: string) {
    return this.baseClient.scard(key);
  }

  // inside RedisPubSubService
  async hset(
    key: string,
    fieldOrObject: string | Record<string, any>,
    ...rest: any[]
  ) {
    // case 1: object map
    if (typeof fieldOrObject === 'object' && fieldOrObject !== null) {
      const flat: string[] = [];
      for (const [f, v] of Object.entries(fieldOrObject)) {
        flat.push(f, typeof v === 'string' ? v : JSON.stringify(v));
      }
      if (flat.length === 0) return 0;
      return this.baseClient.hset(key, ...flat);
    }

    // case 2: field, value OR field1, val1, field2, val2, ...
    const args: string[] = [];
    // first field is fieldOrObject (string)
    args.push(fieldOrObject as string);

    // if rest is empty -> invalid; if rest length odd -> last value undefined handling
    if (rest.length === 0) {
      throw new Error('hset requires value when first arg is field name');
    }

    // rest may be a single value (field, value) or multiple field/value pairs
    // If rest length is 1 -> single value for the first field
    if (rest.length === 1) {
      const v = rest[0];
      args.push(typeof v === 'string' ? v : JSON.stringify(v));
      return this.baseClient.hset(key, ...args);
    }

    // If rest length > 1, interpret as alternating values for additional fields:
    // We already pushed field1; now rest should be [val1, field2, val2, field3, val3...] OR [val1, field2, val2,...]
    // To support call style hset(key, 'server', serverId, 'last_active', String(now))
    // we will treat arguments as pairs: field1, val1, field2, val2, ...
    // Because caller already passed field1, rest should be [val1, field2, val2, ...]
    // Build final flat array: [field1, val1, field2, val2, ...]
    const firstVal = rest[0];
    args.push(
      typeof firstVal === 'string' ? firstVal : JSON.stringify(firstVal)
    );

    // remaining pairs start from rest[1]
    for (let i = 1; i < rest.length; i += 2) {
      const field = rest[i];
      const value = rest[i + 1];
      if (typeof field === 'undefined' || typeof value === 'undefined') {
        // ignore incomplete pair
        break;
      }
      args.push(String(field));
      args.push(typeof value === 'string' ? value : JSON.stringify(value));
    }

    return this.baseClient.hset(key, ...args);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.baseClient.hget(key, field);
  }

  async hdel(key: string, ...fields: string[]) {
    return this.baseClient.hdel(key, ...fields);
  }

  pipeline(): ChainableCommander {
    return this.baseClient.pipeline();
  }

  // =========================
  // 🔧 UTILITIES
  // =========================
  async enableKeyspaceEvents() {
    await this.pub.config('SET', 'notify-keyspace-events', 'Ex');
  }

  async flushByPrefix(prefix: string) {
    const keys = await this.keys(`${prefix}:*`);
    if (keys.length > 0) await this.del(...keys);
  }

  duplicate(): Redis {
    return this.baseClient.duplicate();
  }

  async quitAll() {
    await this.pub.quit();
    await this.sub.quit();
    await this.baseClient.quit();
  }

  // =========================
  // 🔍 SCAN STREAM
  // =========================
  scanStream(pattern: string, count = 100) {
    return this.baseClient.scanStream({
      match: pattern,
      count,
    });
  }
}
