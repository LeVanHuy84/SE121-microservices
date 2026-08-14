import { InjectRedis } from "@nestjs-modules/ioredis";
import { Injectable } from "@nestjs/common";
import { StatsEventType, TargetType } from "@repo/dtos";
import Redis from "ioredis";

@Injectable()
export class StatsBufferService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * Cập nhật thống kê cho 1 đối tượng (post/share)
   */
  async updateStat(
    targetType: TargetType,
    targetId: string,
    type: StatsEventType,
    delta: number,
    subType?: string,
  ) {
    const key = `stats:buffer:${targetType}:${targetId}`;
    const field = subType ? `${type}:${subType}` : type;

    const pipeline = this.redis.pipeline();
    pipeline.hincrby(key, field, delta);

    const ttl = await this.redis.ttl(key);
    if (ttl === -1) pipeline.expire(key, 3600); // 1 giờ

    await pipeline.exec();
  }

  /**
   * Cập nhật nhiều loại stat cùng lúc
   */
  async updateMultipleStats(
    targetType: TargetType,
    targetId: string,
    updates: { type: StatsEventType; delta: number; subType?: string }[],
  ) {
    const key = `stats:buffer:${targetType}:${targetId}`;
    const pipeline = this.redis.pipeline();

    for (const { type, delta, subType } of updates) {
      const field = subType ? `${type}:${subType}` : type;
      pipeline.hincrby(key, field, delta);
    }

    const ttl = await this.redis.ttl(key);
    if (ttl === -1) pipeline.expire(key, 3600);

    await pipeline.exec();
  }

  /**
   * Lấy toàn bộ buffer trong Redis
   * Trả về dạng:
   * {
   *   POST: { "uuid1": {...}, "uuid2": {...} },
   *   SHARE: { "uuid3": {...} }
   * }
   */
  async getAllBufferedStats(): Promise<
    Record<TargetType, Record<string, Record<string, number>>>
  > {
    const keys = await this.redis.keys("stats:buffer:*");

    // 🔹 Khởi tạo rỗng cho mọi TargetType trong enum
    const results = Object.values(TargetType).reduce(
      (acc, type) => ({ ...acc, [type]: {} }),
      {} as Record<TargetType, Record<string, Record<string, number>>>,
    );

    for (const key of keys) {
      const [, , targetType, targetId] = key.split(":");
      const data = await this.redis.hgetall(key);

      // Nếu Redis chứa key của loại mà enum chưa có (phòng lỗi)
      if (!(targetType in results)) continue;

      results[targetType as TargetType][targetId] = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, Number(v)]),
      );
    }

    return results;
  }

  async clearBuffer(targetType: TargetType, targetId: string) {
    await this.redis.del(`stats:buffer:${targetType}:${targetId}`);
  }

  async clearMultipleBuffers(
    entries: { targetType: TargetType; targetId: string }[],
  ) {
    const pipeline = this.redis.pipeline();
    for (const { targetType, targetId } of entries) {
      pipeline.del(`stats:buffer:${targetType}:${targetId}`);
    }
    await pipeline.exec();
  }
}
