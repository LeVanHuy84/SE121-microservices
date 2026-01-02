import { InjectRedis } from '@nestjs-modules/ioredis';
import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { BaseUserDTO } from '@repo/dtos';
import Redis from 'ioredis';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class UserClientService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy
  ) {}

  async getUserInfo(userId: string): Promise<BaseUserDTO | null> {
    if (!userId) return null;

    // 1️⃣ Check cache
    const cached = await this.redis.hgetall(`user:profile:${userId}`);
    if (cached && Object.keys(cached).length > 0) {
      return {
        id: userId,
        firstName: cached.firstName ?? '',
        lastName: cached.lastName ?? '',
        avatarUrl: cached.avatarUrl ?? '',
      };
    }

    // 2️⃣ Gọi batch API (với 1 userId)
    const fetchedProfiles: Record<string, BaseUserDTO> = await lastValueFrom(
      this.userClient.send<Record<string, BaseUserDTO>>('getBaseUsersBatch', [
        userId,
      ])
    );

    const profile = fetchedProfiles?.[userId];
    if (!profile) return null;

    // 3️⃣ Cache lại
    const cacheData = {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      avatarUrl: profile.avatarUrl ?? '',
    };
    await this.redis.hmset(`user:profile:${userId}`, cacheData);
    await this.redis.expire(`user:profile:${userId}`, 60 * 5);

    return profile;
  }

  async getUserInfos(userIds: string[]): Promise<Record<string, BaseUserDTO>> {
    if (!userIds.length) return {};

    const profiles: Record<string, BaseUserDTO> = {};
    const uncachedIds: string[] = [];

    // 1️⃣ Check cache
    const pipeline = this.redis.pipeline();
    userIds.forEach((id) => pipeline.hgetall(`user:profile:${id}`));
    const results = await pipeline.exec();

    if (!results) return {}; // Fix TS error: possibly null

    results.forEach(([error, data], index) => {
      const userId = userIds[index];
      const hash = data as Record<string, string>; // Fix TS: type {}

      if (error || !hash || Object.keys(hash).length === 0) {
        uncachedIds.push(userId);
      } else {
        profiles[userId] = {
          id: userId,
          firstName: hash.firstName ?? '',
          lastName: hash.lastName ?? '',
          avatarUrl: hash.avatarUrl ?? '',
        };
      }
    });

    // 2️⃣ Fetch uncached IDs
    if (uncachedIds.length > 0) {
      const fetchedProfiles: Record<string, BaseUserDTO> = await lastValueFrom(
        this.userClient.send<Record<string, BaseUserDTO>>(
          'getBaseUsersBatch',
          uncachedIds
        )
      );

      for (const [id, profile] of Object.entries(fetchedProfiles)) {
        profiles[id] = profile;
        const cacheData = {
          firstName: profile.firstName ?? '',
          lastName: profile.lastName ?? '',
          avatarUrl: profile.avatarUrl ?? '',
        };
        await this.redis.hmset(`user:profile:${id}`, cacheData);
        await this.redis.expire(`user:profile:${id}`, 60 * 5);
      }
    }

    return profiles;
  }
}
