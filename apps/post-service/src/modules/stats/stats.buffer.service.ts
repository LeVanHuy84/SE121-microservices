import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { StatsEventType } from '@repo/dtos';
import Redis from 'ioredis';

@Injectable()
export class StatsBufferService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  /**
   * @param postId  ID của bài post (hoặc post gốc nếu là share)
   * @param type    Loại thống kê ('like' | 'comment' | 'share')
   * @param delta   +1 khi tạo, -1 khi xóa / hủy
   */
  async updateStat(postId: string, type: StatsEventType, delta: number) {
    const key = `post:stats:buffer:${postId}`;

    await this.redis.hincrby(key, type, delta);
    // nếu chưa có key thì đặt TTL, nhưng không reset TTL khi update
    const ttl = await this.redis.ttl(key);
    if (ttl === -1) {
      await this.redis.expire(key, 3600);
    }
  }

  async getAllBufferedStats(): Promise<Record<string, any>> {
    const keys = await this.redis.keys('post:stats:buffer:*');
    const results: Record<string, any> = {};

    for (const key of keys) {
      const postId = key.split(':').pop();
      const data = await this.redis.hgetall(key);
      if (postId)
        results[postId] = Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, Number(v)])
        );
    }

    return results;
  }

  async clearBuffer(postId: string) {
    await this.redis.del(`post:stats:buffer:${postId}`);
  }
}
