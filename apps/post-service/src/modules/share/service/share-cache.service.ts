import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { ShareStat } from 'src/entities/share-stat.entity';
import { Share } from 'src/entities/share.entity';
import { In, Repository } from 'typeorm';

@Injectable()
export class ShareCacheService {
  private readonly SHARE_TTL = 3600; // 1h
  private readonly SHARE_STAT_TTL = 60; // 1min
  private readonly RELATION_TTL = 300;

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @InjectRepository(Share) private readonly shareRepo: Repository<Share>,
    @InjectRepository(ShareStat)
    private readonly shareStatRepo: Repository<ShareStat>
  ) {}

  private shareKey(id: string) {
    return `share:${id}`;
  }

  private statKey(shareId: string) {
    return `share:${shareId}:stat`;
  }

  /** 🔹 Get a single cached Share */
  async getShare(shareId: string): Promise<Share | null> {
    const cached = await this.redis.get(this.shareKey(shareId));

    if (cached) {
      const share = JSON.parse(cached) as Share;
      await this.redis.expire(this.shareKey(shareId), this.SHARE_TTL);

      const stat = await this.getStat(shareId);
      if (stat) share.shareStat = stat;
      return share;
    }

    const share = await this.shareRepo.findOne({
      where: { id: shareId },
      relations: ['post', 'shareStat'],
    });

    if (!share) return null;

    const { shareStat, ...shareData } = share;
    const pipeline = this.redis.pipeline();

    pipeline.setex(
      this.shareKey(share.id),
      this.SHARE_TTL,
      JSON.stringify(shareData)
    );
    if (shareStat)
      pipeline.setex(
        this.statKey(share.id),
        this.SHARE_STAT_TTL,
        JSON.stringify(shareStat)
      );

    await pipeline.exec();

    return share;
  }

  /** 🔹 Batch get multiple cached Shares, fallback to DB */
  async getSharesBatch(shareIds: string[]): Promise<Share[]> {
    if (!shareIds.length) return [];

    const keys = shareIds.map((id) => this.shareKey(id));
    const cachedValues = await this.redis.mget(...keys);

    const shares: Share[] = [];
    const missingIds: string[] = [];

    cachedValues.forEach((cached, i) => {
      if (cached) {
        const share = JSON.parse(cached) as Share;
        shares.push(share);
      } else {
        missingIds.push(shareIds[i]);
      }
    });

    if (missingIds.length > 0) {
      const dbShares = await this.shareRepo.find({
        where: { id: In(missingIds) },
        relations: ['post', 'shareStat'],
      });

      const pipeline = this.redis.pipeline();
      for (const share of dbShares) {
        const { shareStat, ...shareData } = share;
        pipeline.setex(
          this.shareKey(share.id),
          this.SHARE_TTL,
          JSON.stringify(shareData)
        );
        if (shareStat)
          pipeline.setex(
            this.statKey(share.id),
            this.SHARE_STAT_TTL,
            JSON.stringify(shareStat)
          );
      }
      await pipeline.exec();

      shares.push(...dbShares);
    }

    const statMap = await this.getStatsBatch(shareIds);
    for (const share of shares) {
      const stat = statMap.get(share.id);
      if (stat) share.shareStat = stat;
    }

    return shares;
  }

  // ----------------------------------------
  // 📊 Cache Stat
  // ----------------------------------------
  private async getStatsBatch(
    shareIds: string[]
  ): Promise<Map<string, ShareStat>> {
    if (!shareIds.length) return new Map();

    const keys = shareIds.map((id) => this.statKey(id));
    const pipeline = this.redis.pipeline();
    keys.forEach((k) => pipeline.get(k));
    const results = (await pipeline.exec()) as [Error | null, string | null][];

    const stats = new Map<string, ShareStat>();
    const missingIds: string[] = [];

    results.forEach(([err, cached], i) => {
      if (cached) stats.set(shareIds[i], JSON.parse(cached) as ShareStat);
      else missingIds.push(shareIds[i]);
    });

    if (missingIds.length) {
      const dbStats = await this.shareStatRepo.find({
        where: { shareId: In(missingIds) },
      });
      const pipe = this.redis.pipeline();
      for (const s of dbStats) {
        stats.set(s.shareId, s);
        pipe.setex(
          this.statKey(s.shareId),
          this.SHARE_STAT_TTL,
          JSON.stringify(s)
        );
      }
      await pipe.exec();
    }

    return stats;
  }

  private async getStat(shareId: string): Promise<ShareStat | null> {
    const cached = await this.redis.get(this.statKey(shareId));
    if (cached) return JSON.parse(cached);

    const stat = await this.shareStatRepo.findOne({ where: { shareId } });
    if (stat)
      await this.redis.setex(
        this.statKey(shareId),
        this.SHARE_STAT_TTL,
        JSON.stringify(stat)
      );
    return stat;
  }

  async removeCache(postId: string): Promise<void> {
    await this.redis
      .pipeline()
      .del(this.shareKey(postId))
      .del(this.statKey(postId))
      .exec();
  }

  // ----------------------------------------
  // 🧍‍♂️ Cache Relationship
  // ----------------------------------------
  async getRelationship(
    userId: string,
    targetId: string,
    fetchFn: () => Promise<string>
  ): Promise<string> {
    const key = `relationship:${userId}:${targetId}`;
    const cached = await this.redis.get(key);
    if (cached) return cached;

    const relation = await fetchFn();

    const pipeline = this.redis.pipeline();
    pipeline.setex(key, this.RELATION_TTL, relation);
    pipeline.setex(
      `relationship:${targetId}:${userId}`,
      this.RELATION_TTL,
      this.reverseRelation(relation)
    );
    await pipeline.exec();

    return relation;
  }

  private reverseRelation(relation: string): string {
    switch (relation) {
      case 'BLOCKED':
        return 'BLOCKED_BY';
      case 'BLOCKED_BY':
        return 'BLOCKED';
      default:
        return relation;
    }
  }
}
