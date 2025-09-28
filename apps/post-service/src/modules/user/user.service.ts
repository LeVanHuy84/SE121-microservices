import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { MICROSERVICES_CLIENT } from 'src/constant';
import { RedisService } from '../redis/redis.service';
import { BaseUserDTO } from '@repo/dtos';

@Injectable()
export class UserService {
  private readonly CACHE_TTL = 60 * 10;

  constructor(
    @Inject(MICROSERVICES_CLIENT.USER_SERVICE)
    private readonly userRedisClient: ClientProxy,
    private readonly redisService: RedisService
  ) {}

  async getUsersBatch(
    userIds: string[]
  ): Promise<Record<string, BaseUserDTO | null>> {
    const result: Record<string, BaseUserDTO | null> = {};
    const missIds: string[] = [];

    // 1. Check cache
    for (const id of userIds) {
      const cacheKey = `user:${id}`;
      const cached = await this.redisService.get<BaseUserDTO>(cacheKey);
      if (cached) {
        result[id] = cached;
      } else {
        missIds.push(id);
      }
    }

    // 2. Nếu có miss → gọi user-service
    if (missIds.length > 0) {
      try {
        const users: Record<string, BaseUserDTO> = await firstValueFrom(
          this.userRedisClient.send<Record<string, BaseUserDTO>>(
            'getBaseUsersBatch',
            missIds
          )
        );

        for (const id of missIds) {
          const user = users?.[id] ?? null;
          result[id] = user;

          if (user) {
            await this.redisService.set(`user:${id}`, user, this.CACHE_TTL);
          }
        }
      } catch (err) {
        throw new RpcException(`User service failed for ids: ${missIds}`);
      }
    }

    return result;
  }
}
