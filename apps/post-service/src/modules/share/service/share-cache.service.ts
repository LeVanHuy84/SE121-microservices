import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Share } from 'src/entities/share.entity';
import { In, Repository } from 'typeorm';

@Injectable()
export class ShareCacheService {
  private readonly SHARE_TTL = 3600; // 1h
  private readonly SHARE_STAT_TTL = 60; // 1min

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private shareKey(id: string) {
    return `share:${id}`;
  }

  private statKey(id: string) {
    return `shareStat:${id}`;
  }

  /** 🔹 Get a single cached Share */
  async getCachedShare(id: string): Promise<Share | null> {
    const key = this.shareKey(id);
    const json = await this.redis.get(key);
    return json ? (JSON.parse(json) as Share) : null;
  }

  /** 🔹 Set single Share cache */
  async setCachedShare(share: Share): Promise<void> {
    const key = this.shareKey(share.id);
    await this.redis.set(key, JSON.stringify(share), 'EX', this.SHARE_TTL);
  }

  /** 🔹 Batch get multiple cached Shares, fallback to DB */
  async getCachedSharesBatch(
    ids: string[],
    repo: Repository<Share>
  ): Promise<Share[]> {
    const keys = ids.map((id) => this.shareKey(id));
    const cached = await this.redis.mget(keys);

    const result: Share[] = [];
    const missingIds: string[] = [];

    cached.forEach((item, index) => {
      if (item) {
        result.push(JSON.parse(item));
      } else {
        missingIds.push(ids[index]);
      }
    });

    if (missingIds.length) {
      const fresh = await repo.find({
        where: { id: In(missingIds) },
        relations: ['post', 'shareStat'],
      });
      if (fresh.length) {
        const pipeline = this.redis.pipeline();
        for (const s of fresh) {
          pipeline.set(
            this.shareKey(s.id),
            JSON.stringify(s),
            'EX',
            this.SHARE_TTL
          );
        }
        await pipeline.exec();
      }
      result.push(...fresh);
    }

    // Reorder to original order
    return ids.map((id) => result.find((s) => s.id === id)!).filter(Boolean);
  }

  /** 🔹 Get shareStat cache */
  async getCachedStat(shareId: string): Promise<any | null> {
    const key = this.statKey(shareId);
    const json = await this.redis.get(key);
    return json ? JSON.parse(json) : null;
  }

  /** 🔹 Set shareStat cache */
  async setCachedStat(shareId: string, stat: any): Promise<void> {
    const key = this.statKey(shareId);
    await this.redis.set(key, JSON.stringify(stat), 'EX', this.SHARE_STAT_TTL);
  }

  /** 🔹 Batch get shareStat cache (optional) */
  async getCachedStatsBatch(
    ids: string[],
    repo: Repository<any>
  ): Promise<any[]> {
    const keys = ids.map((id) => this.statKey(id));
    const cached = await this.redis.mget(keys);
    const result: any[] = [];
    const missingIds: string[] = [];

    cached.forEach((item, index) => {
      if (item) {
        result.push(JSON.parse(item));
      } else {
        missingIds.push(ids[index]);
      }
    });

    if (missingIds.length) {
      const fresh = await repo.findByIds(missingIds);
      if (fresh.length) {
        const pipeline = this.redis.pipeline();
        for (const s of fresh) {
          pipeline.set(
            this.statKey(s.id),
            JSON.stringify(s),
            'EX',
            this.SHARE_STAT_TTL
          );
        }
        await pipeline.exec();
      }
      result.push(...fresh);
    }

    return result;
  }

  async removeCachedShare(id: string): Promise<void> {
    const key = this.shareKey(id);
    await this.redis.del(key);
  }
}
