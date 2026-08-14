import { Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { TargetType } from "@repo/dtos";

export type ActivityType = "reaction" | "comment" | "share";

export interface RecentActivity {
  idempotentKey: string;
  actorId: string;
  type: ActivityType;
  targetType: TargetType;
  targetId: string;
}

@Injectable()
export class RecentActivityBufferService {
  private readonly logger = new Logger(RecentActivityBufferService.name);
  private readonly TTL_SECONDS = 300; // 5 phút
  private readonly PROCESSING_TTL_SECONDS = 300; // 5 phút cho snapshot key

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private getRedisKey(activity: RecentActivity): string {
    return `recent:activity:${activity.type}:${activity.targetType}:${activity.targetId}`;
  }

  /** 🆕 Lưu hoặc ghi đè activity gần nhất */
  async addRecentActivity(activity: RecentActivity) {
    const key = this.getRedisKey(activity);
    await this.redis.set(key, JSON.stringify(activity), "EX", this.TTL_SECONDS);
    this.logger.debug(
      `💾 Cached ${activity.type} for ${activity.targetType}:${activity.targetId} (user ${activity.actorId})`,
    );
  }

  /** 📸 Snapshot tất cả activity và chuyển sang vùng processing */
  async snapshotAndGetAll(): Promise<Record<string, RecentActivity>> {
    const keys = await this.redis.keys("recent:activity:*");
    const snapshot: Record<string, RecentActivity> = {};
    if (keys.length === 0) return snapshot;

    const pipeline = this.redis.pipeline();

    for (const key of keys) {
      const processingKey = key.replace(
        "recent:activity:",
        "recent:activity:processing:",
      );
      // atomic rename + đặt TTL cho snapshot key (phòng crash)
      pipeline.rename(key, processingKey);
      pipeline.expire(processingKey, this.PROCESSING_TTL_SECONDS);
      pipeline.get(processingKey);
    }

    const results = await pipeline.exec();
    if (!results) return snapshot; // tránh null case

    // Mỗi key xử lý 3 lệnh => rename / expire / get
    for (let i = 0; i < keys.length; i++) {
      const getResult = results[i * 3 + 2]?.[1] as string | null;
      if (!getResult) continue;
      const [, , , type, targetType, targetId] = keys[i].split(":");
      snapshot[`${type}:${targetType}:${targetId}`] = JSON.parse(getResult);
    }

    return snapshot;
  }

  /** 🧹 Xoá toàn bộ snapshot key sau khi flush xong */
  async clearProcessingSnapshot() {
    const keys = await this.redis.keys("recent:activity:processing:*");
    if (keys.length > 0) {
      await this.redis.del(...keys);
      this.logger.debug(`🧹 Cleared ${keys.length} processing activities`);
    }
  }
}
