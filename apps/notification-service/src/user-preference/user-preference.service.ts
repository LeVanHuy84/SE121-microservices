import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RedisService } from '@repo/common';
import { Model } from 'mongoose';
import { UserPreference } from 'src/mongo/schema/user-preference.schema';

@Injectable()
export class UserPreferenceService {
  constructor(
    @InjectModel(UserPreference.name)
    private userPreferenceModel: Model<UserPreference>,
    private readonly redisService: RedisService
  ) {}
  private cacheKey(userId: string) {
    return `pref:${userId}`;
  }
  async getUserPreferences(userId: string) {
    const key = this.cacheKey(userId);
    const raw = await this.redisService.get(key);
    if (raw) return JSON.parse(raw);
    const doc = await this.userPreferenceModel.findOne({ userId }).lean();
    if (doc) {
      await this.redisService.set(key, JSON.stringify(doc), 60 * 5); // cache 5 minutes
      return doc;
    }
    // default preference
    const def = {
      userId,
      allowedChannels: ['web'],
      limits: { dailyLimit: 100 },
    };
    await this.redisService.set(key, JSON.stringify(def), 60 * 5);
    return def;
  }
  async setUserPreferences(userId: string, prefs: Partial<UserPreference>) {
    const updated = await this.userPreferenceModel.findOneAndUpdate(
      { userId },
      prefs,
      {
        upsert: true,
        new: true,
      }
    );
    await this.redisService.set(
      this.cacheKey(userId),
      JSON.stringify(updated),

      60 * 5
    );
    return updated;
  }

  // Simple rate limit per user per day (returns true if allowed)
  async checkAndIncrementDailyLimit(userId: string, limit: number) {
    const ymd = new Date().toISOString().slice(0, 10);
    const key = `rl:${userId}:${ymd}`;
    const val = await this.redisService.incr(key);
    if (val === 1) {
      // set TTL to midnight
      const now = new Date();
      const tomorrow = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1
      );
      const ttlSec = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
      await this.redisService.expire(key, ttlSec);
    }
    return val <= limit;
  }
}
