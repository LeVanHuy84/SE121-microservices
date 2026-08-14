import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";

export type SocialActivityType = "friendship_request" | "friendship_accept";

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

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private getRedisKey(activity: RecentSocialActivity): string {
    return `recent:activity:${activity.type}:${activity.targetId}:${activity.actorId}`;
  }

  private getLogicalKey(activity: RecentSocialActivity): string {
    return `${activity.type}:${activity.targetId}:${activity.actorId}`;
  }

  private getProcessingRedisKey(activity: RecentSocialActivity): string {
    return this.getRedisKey(activity).replace(
      "recent:activity:",
      "recent:activity:processing:",
    );
  }

  private getProcessingRedisKeyFromLogicalKey(logicalKey: string): string {
    return `recent:activity:processing:${logicalKey}`;
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      if (batch?.length) {
        keys.push(...batch);
      }
    } while (cursor !== "0");

    return keys;
  }

  async addRecentActivity(activity: RecentSocialActivity) {
    const key = this.getRedisKey(activity);
    await this.redis.set(key, JSON.stringify(activity), "EX", this.ttlSeconds);
    this.logger.debug(
      `Cached ${activity.type} for target:${activity.targetId} actor:${activity.actorId}`,
    );
  }

  async snapshotAndGetAll(): Promise<Record<string, RecentSocialActivity>> {
    const allKeys = await this.scanKeys("recent:activity:*");
    const keys = allKeys.filter(
      (key) => !key.startsWith("recent:activity:processing:"),
    );
    const snapshot: Record<string, RecentSocialActivity> = {};

    if (keys.length === 0) {
      return snapshot;
    }

    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const processingKey = key.replace(
        "recent:activity:",
        "recent:activity:processing:",
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

      const activity = JSON.parse(getResult) as RecentSocialActivity;
      snapshot[this.getLogicalKey(activity)] = activity;
    }

    this.logger.debug(
      `Snapshot ${Object.keys(snapshot).length} activities`,
      snapshot,
    );

    return snapshot;
  }

  async clearProcessingSnapshot() {
    const keys = await this.scanKeys("recent:activity:processing:*");
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
      this.logger.debug(
        `Cleared activity ${type}:${targetId} actor:${actorId}`,
      );
    }
  }

  async acknowledgeProcessingActivities(logicalKeys: string[]): Promise<void> {
    if (logicalKeys.length === 0) {
      return;
    }

    const processingKeys = logicalKeys.map((logicalKey) =>
      this.getProcessingRedisKeyFromLogicalKey(logicalKey),
    );
    await this.redis.del(...processingKeys);
    this.logger.debug(
      `Acknowledged ${logicalKeys.length} processing activities`,
    );
  }

  async requeueProcessingActivities(
    activities: RecentSocialActivity[],
  ): Promise<void> {
    if (activities.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    for (const activity of activities) {
      pipeline.set(
        this.getRedisKey(activity),
        JSON.stringify(activity),
        "EX",
        this.ttlSeconds,
      );
      pipeline.del(this.getProcessingRedisKey(activity));
    }

    await pipeline.exec();
    this.logger.warn(`Requeued ${activities.length} activities for retry`);
  }
}
