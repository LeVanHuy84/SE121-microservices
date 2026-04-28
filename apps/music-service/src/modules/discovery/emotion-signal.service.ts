import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { UserEmotionSignalDto, EmotionTimeWindow, RiskLevel } from '@repo/dtos';

const CACHE_TTL_SECONDS = 900; // 15 min
const GET_USER_EMOTION_SIGNAL_PATTERN = 'get_user_emotion_signal';

@Injectable()
export class EmotionSignalService {
  private readonly logger = new Logger(EmotionSignalService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,

    @Inject('EMOTION_INTELLIGENCE_SERVICE')
    private readonly emotionClient: ClientProxy,
  ) {}

  // =========================
  // PUBLIC API
  // =========================

  async getUserEmotionSignal(
    userId: string,
  ): Promise<UserEmotionSignalDto | null> {
    try {
      const cached = await this.getCachedSignal(userId);
      if (cached) return cached;

      const fetched = await this.fetchFromEmotionService(userId);
      if (!fetched) return null;

      const normalized = this.normalizeSignal(fetched);

      this.logger.debug(
        `Emotion signal for user ${userId}: ${JSON.stringify(normalized)}`,
      );

      await this.cacheSignal(userId, normalized);

      return normalized;
    } catch (error) {
      this.logger.warn(
        `Failed to get emotion signal for user ${userId}: ${
          (error as Error).message
        }`,
      );
      return null;
    }
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.redis.del(this.getCacheKey(userId));
  }

  // =========================
  // CACHE
  // =========================

  private getCacheKey(userId: string): string {
    return `cache:emotion:signal:${userId}`;
  }

  private async getCachedSignal(
    userId: string,
  ): Promise<UserEmotionSignalDto | null> {
    const cached = await this.redis.get(this.getCacheKey(userId));
    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached);
      return this.normalizeSignal(parsed);
    } catch {
      return null;
    }
  }

  private async cacheSignal(
    userId: string,
    signal: UserEmotionSignalDto,
  ): Promise<void> {
    await this.redis.setex(
      this.getCacheKey(userId),
      CACHE_TTL_SECONDS,
      JSON.stringify(signal),
    );
  }

  // =========================
  // FETCH
  // =========================

  private async fetchFromEmotionService(
    userId: string,
  ): Promise<UserEmotionSignalDto | null> {
    try {
      const response = await firstValueFrom(
        this.emotionClient.send(GET_USER_EMOTION_SIGNAL_PATTERN, {
          userId,
        }),
      );

      this.logger.debug(
        `Fetched emotion signal for user ${userId}: ${JSON.stringify(response)}`,
      );

      return response ?? null;
    } catch (error) {
      this.logger.warn(
        `TCP request failed for user ${userId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  // =========================
  // NORMALIZE (DEFENSIVE ONLY)
  // =========================

  private normalizeSignal(signal: UserEmotionSignalDto): UserEmotionSignalDto {
    return {
      ...signal,

      emotionVector: this.normalizeEmotionVector(signal.emotionVector),

      negativity: this.safeNumber(signal.negativity),
      volatility: this.safeNumber(signal.volatility),
      trend: this.safeNumber(signal.trend),
      momentum: this.safeNumber(signal.momentum),

      riskScore: this.safeNumber(signal.riskScore),

      riskLevel: this.normalizeRiskLevel(signal.riskLevel),

      window:
        signal.window === EmotionTimeWindow.ONE_DAY
          ? EmotionTimeWindow.ONE_DAY
          : EmotionTimeWindow.ONE_DAY,

      computedAt: signal.computedAt ? new Date(signal.computedAt) : new Date(),
    };
  }

  private normalizeEmotionVector(
    vector: Record<string, number> = {},
  ): Record<string, number> {
    const entries = Object.entries(vector);

    if (entries.length === 0) {
      return { neutral: 1 };
    }

    const total = entries.reduce((sum, [, v]) => sum + (Number(v) || 0), 0);

    if (total <= 0) return vector;

    const normalized: Record<string, number> = {};
    for (const [k, v] of entries) {
      normalized[k] = (Number(v) || 0) / total;
    }

    return normalized;
  }

  private normalizeRiskLevel(level: RiskLevel): RiskLevel {
    switch (level) {
      case RiskLevel.CRITICAL:
      case RiskLevel.HIGH:
      case RiskLevel.WARNING:
      case RiskLevel.NORMAL:
        return level;
      default:
        return RiskLevel.NORMAL;
    }
  }

  private safeNumber(value: unknown): number {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }
}
