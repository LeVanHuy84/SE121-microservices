import { Injectable } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { PostSnapshot } from 'src/mongo/schema/post-snapshot.schema';
import { ShareSnapshot } from 'src/mongo/schema/share-snapshot.schema';

@Injectable()
export class CacheLayerService {
  private readonly POST_PREFIX = 'cache:post';
  private readonly SHARE_PREFIX = 'cache:share';
  private readonly TTL = 60 * 10; // 10 phút

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ======================
  // POST SNAPSHOT CACHE
  // ======================

  private getPostKey(postId: string): string {
    return `${this.POST_PREFIX}:${postId}`;
  }

  async getPostBatch(ids: string[]): Promise<Map<string, PostSnapshot>> {
    if (!ids?.length) return new Map();

    const keys = ids.map((id) => this.getPostKey(id));
    const results = await this.redis.mget(keys);

    const map = new Map<string, PostSnapshot>();
    ids.forEach((id, i) => {
      const json = results[i];
      if (json) {
        try {
          map.set(id, JSON.parse(json));
        } catch {
          // skip corrupted entry
        }
      }
    });

    return map;
  }

  async setPostBatch(snapshots: PostSnapshot[]): Promise<void> {
    if (!snapshots?.length) return;

    const pipeline = this.redis.pipeline();
    for (const s of snapshots) {
      pipeline.setex(this.getPostKey(s.postId), this.TTL, JSON.stringify(s));
    }
    await pipeline.exec();
  }

  async delPost(id: string): Promise<void> {
    await this.redis.del(this.getPostKey(id));
  }

  // ======================
  // SHARE SNAPSHOT CACHE
  // ======================

  private getShareKey(shareId: string): string {
    return `${this.SHARE_PREFIX}:${shareId}`;
  }

  async getShareBatch(ids: string[]): Promise<Map<string, ShareSnapshot>> {
    if (!ids?.length) return new Map();

    const keys = ids.map((id) => this.getShareKey(id));
    const results = await this.redis.mget(keys);

    const map = new Map<string, ShareSnapshot>();
    ids.forEach((id, i) => {
      const json = results[i];
      if (json) {
        try {
          map.set(id, JSON.parse(json));
        } catch {
          // skip corrupted entry
        }
      }
    });

    return map;
  }

  async setShareBatch(snapshots: ShareSnapshot[]): Promise<void> {
    if (!snapshots?.length) return;

    const pipeline = this.redis.pipeline();
    for (const s of snapshots) {
      pipeline.setex(this.getShareKey(s.shareId), this.TTL, JSON.stringify(s));
    }
    await pipeline.exec();
  }

  async delShare(id: string): Promise<void> {
    await this.redis.del(this.getShareKey(id));
  }
}
