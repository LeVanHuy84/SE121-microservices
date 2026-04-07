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
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  async getUserInfo(userId: string): Promise<BaseUserDTO | null> {
    if (!userId) return null;

    const cacheKey = `user:profile:${userId}`;
    const cached = await this.redis.hgetall(cacheKey);
    if (cached && Object.keys(cached).length > 0) {
      return {
        id: userId,
        firstName: cached.firstName ?? '',
        lastName: cached.lastName ?? '',
        avatarUrl: cached.avatarUrl ?? '',
      };
    }

    const fetchedProfiles: Record<string, BaseUserDTO> = await lastValueFrom(
      this.userClient.send<Record<string, BaseUserDTO>>('getBaseUsersBatch', [
        userId,
      ]),
    );

    const profile = fetchedProfiles?.[userId];
    if (!profile) return null;

    await this.redis.hmset(cacheKey, {
      firstName: profile.firstName ?? '',
      lastName: profile.lastName ?? '',
      avatarUrl: profile.avatarUrl ?? '',
    });
    await this.redis.expire(cacheKey, 60 * 5);

    return profile;
  }
}
