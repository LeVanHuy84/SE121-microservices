import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { GroupInfoDTO } from '@repo/dtos';
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

  private getSummaryKey(id: string) {
    return `group:summary:${id}`;
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

  // ===============================
  // Batch
  // ===============================
  async getBatch(
    groupIds: string[],
  ): Promise<Map<string, GroupInfoDTO | 'NOT_FOUND'>> {
    const keys = groupIds.map((id) => this.getSummaryKey(id));
    const raws = await this.redis.mget(...keys);

    const map = new Map<string, GroupInfoDTO | 'NOT_FOUND'>();

    raws.forEach((raw, index) => {
      if (!raw) return;

      const groupId = groupIds[index];
      if (raw === 'NOT_FOUND') {
        map.set(groupId, 'NOT_FOUND');
      } else {
        map.set(groupId, JSON.parse(raw));
      }
    });

    return map;
  }

  async setBatch(dtos: GroupInfoDTO[]) {
    if (!dtos.length) return;

    const pipeline = this.redis.pipeline();

    for (const dto of dtos) {
      pipeline.set(
        this.getSummaryKey(dto.id),
        JSON.stringify(dto),
        'EX',
        this.TTL,
      );
    }

    await pipeline.exec();
  }

  async setNotFoundBatch(groupIds: string[]) {
    if (!groupIds.length) return;

    const pipeline = this.redis.pipeline();

    for (const id of groupIds) {
      pipeline.set(
        this.getSummaryKey(id),
        'NOT_FOUND',
        'EX',
        this.NEGATIVE_TTL,
      );
    }

    await pipeline.exec();
  }
}
