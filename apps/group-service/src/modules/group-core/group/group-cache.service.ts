import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Group } from 'src/entities/group.entity';

@Injectable()
export class GroupCacheService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  private readonly TTL = 300; // 5 minutes
  private readonly NEGATIVE_TTL = 60; // 1 minute for not-found

  private getKey(id: string) {
    return `group:${id}`;
  }

  async get(groupId: string): Promise<Group | null | 'NOT_FOUND'> {
    const raw = await this.redis.get(this.getKey(groupId));

    if (!raw) return null;

    if (raw === 'NOT_FOUND') return 'NOT_FOUND';

    return JSON.parse(raw);
  }

  async set(groupId: string, data: Group): Promise<void> {
    await this.redis.set(
      this.getKey(groupId),
      JSON.stringify(data),
      'EX',
      this.TTL,
    );
  }

  async setNotFound(groupId: string) {
    // chống spam query vào DB nếu group ko tồn tại
    await this.redis.set(
      this.getKey(groupId),
      'NOT_FOUND',
      'EX',
      this.NEGATIVE_TTL,
    );
  }

  async del(groupId: string) {
    await this.redis.del(this.getKey(groupId));
  }
}
