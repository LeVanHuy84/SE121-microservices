import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ChannelNotification } from '@repo/dtos';
import Redis from 'ioredis';
import { Model } from 'mongoose';
import { UserPreference } from 'src/mongo/schema/user-preference.schema';

type NotificationLimitConfig = {
  dailyLimit?: number;
  burstLimit?: number;
  burstWindowSeconds?: number;
};

type ReserveNotificationSlotResult = {
  allowed: boolean;
  reason?: 'daily' | 'burst';
  dailyCount: number;
  burstCount: number;
};

@Injectable()
export class UserPreferenceService {
  constructor(
    @InjectModel(UserPreference.name)
    private userPreferenceModel: Model<UserPreference>,
    @InjectRedis() private readonly redis: Redis,
  ) {}
  private cacheKey(userId: string) {
    return `pref:${userId}`;
  }
  async getUserPreferences(userId: string) {
    const key = this.cacheKey(userId);
    const raw = await this.redis.get(key);
    if (raw) return JSON.parse(raw);
    const doc = await this.userPreferenceModel.findOne({ userId }).lean();
    if (doc) {
      await this.redis.set(key, JSON.stringify(doc), 'EX', 60 * 5); // cache 5 minutes
      return doc;
    }
    // default preference
    const def = {
      userId,
      allowedChannels: [ChannelNotification.WEBSOCKET],
      limits: { dailyLimit: 100, burstLimit: 10, burstWindowSeconds: 300 },
    };
    await this.redis.set(key, JSON.stringify(def), 'EX', 60 * 5);
    return def;
  }
  async setUserPreferences(userId: string, prefs: Partial<UserPreference>) {
    const updated = await this.userPreferenceModel.findOneAndUpdate(
      { userId },
      prefs,
      {
        upsert: true,
        new: true,
      },
    );
    await this.redis.set(
      this.cacheKey(userId),
      JSON.stringify(updated),
      'EX',
      60 * 5,
    );
    return updated;
  }

  async checkAndIncrementDailyLimit(
    userId: string,
    limit: number,
  ): Promise<boolean> {
    const result = await this.reserveNotificationSlot(userId, 'default', {
      dailyLimit: limit,
      burstLimit: Number.MAX_SAFE_INTEGER,
      burstWindowSeconds: 300,
    });
    return result.allowed;
  }

  async reserveNotificationSlot(
    userId: string,
    type: string,
    limits?: NotificationLimitConfig,
  ): Promise<ReserveNotificationSlotResult> {
    const dailyLimit = limits?.dailyLimit ?? 100;
    const burstLimit = limits?.burstLimit ?? 10;
    const burstWindowSeconds = limits?.burstWindowSeconds ?? 300;

    const ymd = new Date().toISOString().slice(0, 10);
    const dailyKey = `rl:daily:${userId}:${type}:${ymd}`;
    const burstBucket = Math.floor(Date.now() / (burstWindowSeconds * 1000));
    const burstKey = `rl:burst:${userId}:${type}:${burstBucket}`;

    const multi = this.redis.multi();
    multi.incr(dailyKey);
    multi.incr(burstKey);
    const [dailyResult, burstResult] = (await multi.exec()) ?? [];
    const dailyCount = Number(dailyResult?.[1] ?? 0);
    const burstCount = Number(burstResult?.[1] ?? 0);

    const expiryMulti = this.redis.multi();
    if (dailyCount === 1) {
      expiryMulti.expire(dailyKey, this.getSecondsUntilTomorrow());
    }
    if (burstCount === 1) {
      expiryMulti.expire(burstKey, burstWindowSeconds);
    }
    await expiryMulti.exec();

    if (dailyCount > dailyLimit) {
      return {
        allowed: false,
        reason: 'daily',
        dailyCount,
        burstCount,
      };
    }

    if (burstCount > burstLimit) {
      return {
        allowed: false,
        reason: 'burst',
        dailyCount,
        burstCount,
      };
    }

    return {
      allowed: true,
      dailyCount,
      burstCount,
    };
  }

  private getSecondsUntilTomorrow() {
    const now = new Date();
    const tomorrow = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  }
}
