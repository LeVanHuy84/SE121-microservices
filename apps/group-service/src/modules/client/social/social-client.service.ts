import { InjectRedis } from '@nestjs-modules/ioredis';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import Redis from 'ioredis';
import { catchError, lastValueFrom, of, timeout } from 'rxjs';

@Injectable()
export class SocialClientService {
  private readonly logger = new Logger(SocialClientService.name);
  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject('SOCIAL_SERVICE') private readonly socialClient: ClientProxy,
  ) {}

  private readonly FRIENDS_IDS_CACHE_TTL = 300; // 5 minutes
  private getFriendsIdsCacheKey(userId: string): string {
    return `user:${userId}:friendsIds`;
  }

  async getFriendsIds(userId: string): Promise<string[]> {
    const cacheKey = this.getFriendsIdsCacheKey(userId);
    const cachedData = await this.redis.get(cacheKey);
    if (cachedData) {
      return JSON.parse(cachedData);
    }
    const request$ = this.socialClient
      .send<string[]>({ cmd: 'get_friend_ids' }, { userId, limit: 50 })
      .pipe(
        timeout(2000), // 2 giây
        catchError((err) => {
          this.logger.error('❌ SOCIAL_SERVICE timeout or error');
          return of([]); // fallback an toàn
        }),
      );

    const friendsIds = await lastValueFrom(request$);
    const ttl = friendsIds.length === 0 ? 30 : this.FRIENDS_IDS_CACHE_TTL;
    await this.redis.setex(cacheKey, ttl, JSON.stringify(friendsIds));
    return friendsIds;
  }
}
