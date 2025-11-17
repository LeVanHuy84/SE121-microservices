import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { Group } from 'src/entities/group.entity';

@Injectable()
export class GroupCacheService {
  // Implementation of caching logic for groups would go here
  constructor(@InjectRedis() private readonly redis: Redis) {}
  private readonly TTL = 300; // 5 minutes

  private getKey(groupId: string): string {
    return `group:${groupId}`;
  }

  async cacheGroupData(groupId: string, data: Group): Promise<void> {
    await this.redis.set(
      this.getKey(groupId),
      JSON.stringify(data),
      'EX',
      this.TTL,
    );
  }

  async getGroupData(groupId: string): Promise<Group | null> {
    const data = await this.redis.get(this.getKey(groupId));
    return data ? JSON.parse(data) : null;
  }
}
