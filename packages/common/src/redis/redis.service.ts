import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis, { ChainableCommander } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get<T = any>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async set(key: string, value: any, ttlSeconds?: number) {
    const data = JSON.stringify(value);
    if (ttlSeconds) {
      await this.client.set(key, data, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, data);
    }
  }

  async del(key: string) {
    await this.client.del(key);
  }
  /** Tăng giá trị số nguyên trong Redis */
  async incr(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  /** Set thời gian hết hạn cho một key */
  async expire(key: string, ttlSeconds: number): Promise<number> {
    return await this.client.expire(key, ttlSeconds);
  }

  // ---------- ZSET (sorted set) ----------
  async zadd(key: string, score: number, value: any) {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    await this.client.zadd(key, score, str);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.client.zrevrange(key, start, stop);
  }

  async zcard(key: string): Promise<number> {
    return this.client.zcard(key);
  }

  async zremrangebyrank(key: string, start: number, stop: number) {
    await this.client.zremrangebyrank(key, start, stop);
  }

  // ---------- Pipeline (multi-ops) ----------
  pipeline(): ChainableCommander {
    return this.client.pipeline();
  }

  // ---------- Utility ----------
  async flushAll() {
    await this.client.flushall();
  }

  get raw(): Redis {
    return this.client;
  }
}
