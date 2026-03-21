import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

export type SocialActivityType = 'friendship_request' | 'friendship_accept';

export interface RecentSocialActivity {
  actorId: string;
  type: SocialActivityType;
  targetId: string;
}

@Injectable()
export class RecentActivityBufferService {
  private readonly logger = new Logger(RecentActivityBufferService.name);
  private readonly ttlSeconds = 300;
  private readonly processingTtlSeconds = 300;
  private readonly requestActivityWeight = 0.7;
  private readonly acceptActivityWeight = 1;

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private getRedisKey(activity: RecentSocialActivity): string {
    return `recent:activity:${activity.type}:${activity.targetId}:${activity.actorId}`;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        '100',
      );
      cursor = nextCursor;
      if (batch?.length) {
        keys.push(...batch);
      }
    } while (cursor !== '0');

    return keys;
  }

  async addRecentActivity(activity: RecentSocialActivity) {
    const key = this.getRedisKey(activity);
    await this.redis.set(key, JSON.stringify(activity), 'EX', this.ttlSeconds);
    this.logger.debug(
      `Cached ${activity.type} for target:${activity.targetId} actor:${activity.actorId}`,
    );
  }

  async snapshotAndGetAll(): Promise<Record<string, RecentSocialActivity>> {
    const allKeys = await this.scanKeys('recent:activity:*');
    const keys = allKeys.filter(
      (key) => !key.startsWith('recent:activity:processing:'),
    );
    const snapshot: Record<string, RecentSocialActivity> = {};

    if (keys.length === 0) {
      return snapshot;
    }

    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const processingKey = key.replace(
        'recent:activity:',
        'recent:activity:processing:',
      );
      pipeline.rename(key, processingKey);
      pipeline.expire(processingKey, this.processingTtlSeconds);
      pipeline.get(processingKey);
    }

    const results = await pipeline.exec();
    if (!results) {
      return snapshot;
    }

    for (let index = 0; index < keys.length; index += 1) {
      const getResult = results[index * 3 + 2]?.[1] as string | null;
      if (!getResult) {
        continue;
      }

      const [, , type, targetId, actorId] = keys[index].split(':');
      snapshot[`${type}:${targetId}:${actorId}`] = JSON.parse(getResult);
    }

    this.logger.debug(
      `Snapshot ${Object.keys(snapshot).length} activities`,
      snapshot,
    );

    return snapshot;
  }

  async clearProcessingSnapshot() {
    const keys = await this.scanKeys('recent:activity:processing:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.debug(`Cleared ${keys.length} processing activities`);
    }
  }

  async clearActivity(
    type: SocialActivityType,
    targetId: string,
    actorId: string,
  ) {
    const key = `recent:activity:${type}:${targetId}:${actorId}`;
    const deleted = await this.redis.del(key);
    if (deleted) {
      this.logger.debug(`Cleared activity ${type}:${targetId} actor:${actorId}`);
    }
  }

  async getRecentInteractionScores(
    viewerId: string,
    candidateIds: string[],
  ): Promise<Record<string, number>> {
    const dedupedCandidateIds = [...new Set(candidateIds.filter(Boolean))];
    if (!viewerId || dedupedCandidateIds.length === 0) {
      return {};
    }

    const descriptors = dedupedCandidateIds.flatMap((candidateId) => [
      {
        candidateId,
        key: `recent:activity:friendship_request:${candidateId}:${viewerId}`,
        weight: this.requestActivityWeight,
      },
      {
        candidateId,
        key: `recent:activity:friendship_request:${viewerId}:${candidateId}`,
        weight: this.requestActivityWeight,
      },
      {
        candidateId,
        key: `recent:activity:friendship_accept:${candidateId}:${viewerId}`,
        weight: this.acceptActivityWeight,
      },
      {
        candidateId,
        key: `recent:activity:friendship_accept:${viewerId}:${candidateId}`,
        weight: this.acceptActivityWeight,
      },
    ]);

    const pipeline = this.redis.pipeline();
    descriptors.forEach((descriptor) => pipeline.ttl(descriptor.key));
    const results = await pipeline.exec();

    if (!results) {
      return {};
    }

    return descriptors.reduce<Record<string, number>>((acc, descriptor, index) => {
      const ttl = Number(results[index]?.[1] ?? -2);
      if (!Number.isFinite(ttl) || ttl <= 0) {
        if (acc[descriptor.candidateId] === undefined) {
          acc[descriptor.candidateId] = 0;
        }
        return acc;
      }

      const normalizedScore = Math.min(ttl, this.ttlSeconds) / this.ttlSeconds;
      const weightedScore = Number(
        (normalizedScore * descriptor.weight).toFixed(6),
      );
      acc[descriptor.candidateId] = Math.max(
        acc[descriptor.candidateId] ?? 0,
        weightedScore,
      );
      return acc;
    }, {});
  }
}
