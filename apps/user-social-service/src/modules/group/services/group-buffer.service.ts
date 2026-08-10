import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class GroupBufferService {
  private readonly PREFIX = 'group:memberCount:';

  constructor(@InjectRedis() private readonly redis: Redis) {}

  private key(groupId: string | number): string {
    return `${this.PREFIX}${groupId}`;
  }

  /** Buffer member count cho 1 group */
  async buffer(groupId: string, memberCount: number): Promise<void> {
    await this.redis.set(this.key(groupId), String(memberCount));
  }

  /** Lấy member count của 1 group */
  async get(groupId: string): Promise<number | null> {
    const val = await this.redis.get(this.key(groupId));
    return val ? Number(val) : null;
  }

  /** Xoá buffer của group */
  async clear(groupId: string): Promise<void> {
    await this.redis.del(this.key(groupId));
  }

  /** SCAN keys theo prefix (thay .keys để tối ưu Redis) */
  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const reply = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = reply[0];
      keys.push(...reply[1]);
    } while (cursor !== '0');

    return keys;
  }

  /** Lấy toàn bộ groupId → memberCount trong buffer */
  async getAll(): Promise<Record<string, number>> {
    const keys = await this.scanKeys(`${this.PREFIX}*`);
    if (keys.length === 0) return {};

    const result: Record<string, number> = {};

    // batch mget tránh trả quá dài
    const chunkSize = 50;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const values = await this.redis.mget(chunk);

      chunk.forEach((key, idx) => {
        const groupId = key.replace(this.PREFIX, '');
        result[groupId] = Number(values[idx] ?? 0);
      });
    }

    return result;
  }
}
