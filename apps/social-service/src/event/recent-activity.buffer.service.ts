import { Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';

// Các loại activity social
export type SocialActivityType = 'friendship_request' | 'friendship_accept';

export interface RecentSocialActivity {
  actorId: string; // user thực hiện hành động
  type: SocialActivityType;
  targetId: string; // user nhận hành động
}

@Injectable()
export class RecentActivityBufferService {
  private readonly logger = new Logger(RecentActivityBufferService.name);
  private readonly TTL_SECONDS = 300; // 5 phút
  private readonly PROCESSING_TTL_SECONDS = 300; // 5 phút cho snapshot key

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
      if (batch?.length) keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  /** Lưu hoặc ghi đè activity gần nhất */
  async addRecentActivity(activity: RecentSocialActivity) {
    const key = this.getRedisKey(activity);
    await this.redis.set(key, JSON.stringify(activity), 'EX', this.TTL_SECONDS);
    this.logger.debug(
      `💾 Cached ${activity.type} for target:${activity.targetId} (actor ${activity.actorId})`,
    );
  }

  /** Snapshot tất cả activity và chuyển sang vùng processing */
  async snapshotAndGetAll(): Promise<Record<string, RecentSocialActivity>> {
    const allKeys = await this.scanKeys('recent:activity:*');

    // LOẠI BỎ mấy key processing
    const keys = allKeys.filter(
      (k) => !k.startsWith('recent:activity:processing:'),
    );
    const snapshot: Record<string, RecentSocialActivity> = {};
    if (keys.length === 0) return snapshot;

    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const processingKey = key.replace(
        'recent:activity:',
        'recent:activity:processing:',
      );
      pipeline.rename(key, processingKey);
      pipeline.expire(processingKey, this.PROCESSING_TTL_SECONDS);
      pipeline.get(processingKey);
    }

    const results = await pipeline.exec();
    if (!results) return snapshot;

    // Mỗi key xử lý 3 lệnh => rename / expire / get
    for (let i = 0; i < keys.length; i++) {
      const getResult = results[i * 3 + 2]?.[1] as string | null;
      if (!getResult) continue;
      const [, , type, targetId, actorId] = keys[i].split(':');
      snapshot[`${type}:${targetId}:${actorId}`] = JSON.parse(getResult);
    }

    this.logger.debug(
      `📸 Snapshot ${Object.keys(snapshot).length} activities`,
      snapshot,
    );
    return snapshot;
  }

  /** Xoá toàn bộ snapshot key sau khi flush xong */
  async clearProcessingSnapshot() {
    const keys = await this.scanKeys('recent:activity:processing:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.debug(`🧹 Cleared ${keys.length} processing activities`);
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
        `🧹 Cleared activity ${type}:${targetId} (actor ${actorId})`,
      );
    }
  }
}
