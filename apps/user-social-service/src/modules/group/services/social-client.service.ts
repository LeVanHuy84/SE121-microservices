import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { FriendshipService } from '../../social/friendship/friendship.service';

@Injectable()
export class SocialClientService {
  private readonly logger = new Logger(SocialClientService.name);
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly friendshipService: FriendshipService,
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
    let friendsIds: string[] = [];
    try {
      friendsIds = await this.friendshipService.getFriendIds(userId, 50);
    } catch (err) {
      this.logger.error('❌ SOCIAL_SERVICE direct call error: ' + err?.message);
    }
    const ttl = friendsIds.length === 0 ? 30 : this.FRIENDS_IDS_CACHE_TTL;
    await this.redis.setex(cacheKey, ttl, JSON.stringify(friendsIds));
    return friendsIds;
  }
}
