import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { PostSnapshot } from "../mongo/schema/post-snapshot.schema";
import { ShareSnapshot } from "../mongo/schema/share-snapshot.schema";

@Injectable()
export class CacheLayerService {
  private readonly logger = new Logger(CacheLayerService.name);
  private readonly POST_PREFIX = "cache:post";
  private readonly SHARE_PREFIX = "cache:share";
  private readonly TTL = 45; // 45 giây (Option B - Short TTL Snapshot Cache)

  constructor(@InjectRedis() private readonly redis: Redis) {}

  // ======================
  // POST SNAPSHOT CACHE
  // ======================

  private getPostKey(postId: string): string {
    return `${this.POST_PREFIX}:${postId}`;
  }

  async getPostBatch(ids: string[]): Promise<Map<string, PostSnapshot>> {
    if (!ids?.length) return new Map();

    const uniqueIds = Array.from(new Set(ids));
    const keys = uniqueIds.map((id) => this.getPostKey(id));
    const results = await this.redis.mget(keys);

    const map = new Map<string, PostSnapshot>();
    uniqueIds.forEach((id, i) => {
      const json = results[i];
      if (json) {
        try {
          map.set(id, JSON.parse(json));
        } catch (err: any) {
          this.logger.warn(
            `Failed to parse cached post snapshot for id ${id}: ${err?.message}`,
          );
        }
      }
    });

    return map;
  }

  async setPostBatch(snapshots: PostSnapshot[]): Promise<void> {
    if (!snapshots?.length) return;

    const pipeline = this.redis.pipeline();
    for (const s of snapshots) {
      if (s?.postId) {
        pipeline.setex(this.getPostKey(s.postId), this.TTL, JSON.stringify(s));
      }
    }
    await pipeline.exec();
  }

  async delPost(id: string): Promise<void> {
    if (!id) return;
    await this.redis.del(this.getPostKey(id));
  }

  async delPostBatch(ids: string[]): Promise<void> {
    if (!ids?.length) return;
    const keys = ids.map((id) => this.getPostKey(id));
    await this.redis.del(...keys);
  }

  // ======================
  // SHARE SNAPSHOT CACHE
  // ======================

  private getShareKey(shareId: string): string {
    return `${this.SHARE_PREFIX}:${shareId}`;
  }

  async getShareBatch(ids: string[]): Promise<Map<string, ShareSnapshot>> {
    if (!ids?.length) return new Map();

    const uniqueIds = Array.from(new Set(ids));
    const keys = uniqueIds.map((id) => this.getShareKey(id));
    const results = await this.redis.mget(keys);

    const map = new Map<string, ShareSnapshot>();
    uniqueIds.forEach((id, i) => {
      const json = results[i];
      if (json) {
        try {
          map.set(id, JSON.parse(json));
        } catch (err: any) {
          this.logger.warn(
            `Failed to parse cached share snapshot for id ${id}: ${err?.message}`,
          );
        }
      }
    });

    return map;
  }

  async setShareBatch(snapshots: ShareSnapshot[]): Promise<void> {
    if (!snapshots?.length) return;

    const pipeline = this.redis.pipeline();
    for (const s of snapshots) {
      if (s?.shareId) {
        pipeline.setex(
          this.getShareKey(s.shareId),
          this.TTL,
          JSON.stringify(s),
        );
      }
    }
    await pipeline.exec();
  }

  async delShare(id: string): Promise<void> {
    if (!id) return;
    await this.redis.del(this.getShareKey(id));
  }

  async delShareBatch(ids: string[]): Promise<void> {
    if (!ids?.length) return;
    const keys = ids.map((id) => this.getShareKey(id));
    await this.redis.del(...keys);
  }
}
