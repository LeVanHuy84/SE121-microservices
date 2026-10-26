import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectRedis } from "@nestjs-modules/ioredis";
import Redis from "ioredis";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";
import { EmotionRankingFeaturesDto } from "@repo/dtos";
import { PersonalFeedHelper } from "../../feed-pipeline/helpers/personal-feed.helper";

const CACHE_TTL_SECONDS = 900; // 15 min

@Injectable()
export class EmotionFeatureService {
  private readonly logger = new Logger(EmotionFeatureService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    @Inject("EMOTION_INTELLIGENCE_SERVICE")
    private readonly emotionIntelligenceClient: ClientProxy,
  ) {}

  // =========================
  // PUBLIC API
  // =========================

  async getEmotionFeatures(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    try {
      const cached = await this.getCachedFeatures(userId);
      if (cached) return cached;

      const fetched = await this.fetchFromAnalysisService(userId);
      if (!fetched) return null;

      const normalized = this.normalizeFeatures(fetched);

      await this.cacheFeatures(userId, normalized);
      return normalized;
    } catch (error) {
      this.logger.warn(
        `Failed to get emotion features for user ${userId}: ${
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
  // RANKING CORE (ISO-PRINCIPLE)
  // =========================

  calcDistress(features?: Partial<EmotionRankingFeaturesDto> | null): number {
    return PersonalFeedHelper.calcDistress(features);
  }

  calcEmotionScore(
    features: EmotionRankingFeaturesDto,
    post: {
      scores: Record<string, number>;
      confidence?: number;
      mentalHealthRiskLevel?: string;
    },
  ): number {
    this.logger.debug(`User emotion Features: ${JSON.stringify(features)}`);
    this.logger.debug(`Post Scores: ${JSON.stringify(post.scores)}`);

    const isoScore = this.calcIsoPrincipleScore(features, post.scores || {});
    const riskPenalty = this.calcRiskPenalty(features, post.scores || {});
    const confidenceWeight = 0.7 + (post.confidence ?? 0) * 0.3;

    const finalScore = (isoScore - 0.25 * riskPenalty) * confidenceWeight;
    return this.clamp(finalScore);
  }

  calcIsoPrincipleScore(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    const distress = this.calcDistress(features);

    // 1. Chế độ Bình thường (Distress <= 0.3): Đa dạng nội dung & tích cực
    if (distress <= 0.3) {
      const joy = postScores.joy || 0;
      const neutral = postScores.neutral || 0;
      const novelty = this.calcNoveltyScore(features, postScores);
      return this.clamp(0.4 * joy + 0.35 * neutral + 0.25 * novelty);
    }

    // 2. Chế độ Điều hòa & Phục hồi theo Iso-principle (Distress > 0.3):
    const userState = features.userEmotionPreference || {};
    const sadness = userState.sadness || 0;
    const anger = userState.anger || 0;
    const fear = userState.fear || 0;

    // Pha 1: Thấu cảm (Empathetic Matching) - đồng cảm với nỗi buồn nhưng không sa đà
    const empatheticSadness =
      sadness > 0 ? sadness * Math.min(postScores.sadness || 0, 0.7) * 0.45 : 0;

    // Pha 2: Cầu nối Xoa dịu (Calming Bridge)
    // Chuẩn hóa 100% trên 7 nhãn Ekman PhoBERT: nội dung an định, khách quan (neutral) làm trọng tâm xoa dịu
    const calmingBridge = postScores.neutral || 0;

    // Pha 3: Nâng đỡ Nhẹ nhàng (Gentle Uplift) & Phạt Toxic Positivity
    const rawJoy = postScores.joy || 0;
    const isCrisis = distress > 0.6;
    const toxicPositivityPenalty =
      isCrisis && rawJoy > 0.7
        ? (rawJoy - 0.5) * 1.5
        : rawJoy > 0.6
          ? (rawJoy - 0.6) * 0.8
          : 0;
    const gentleJoy = Math.max(0, Math.min(rawJoy, 0.6) - toxicPositivityPenalty);

    // Chống Buồng vang Bi quan (Doomscrolling Echo Penalty):
    const excessiveSadness = Math.max(0, (postScores.sadness || 0) - 0.7);
    const echoPenalty =
      sadness * excessiveSadness * 1.5 +
      anger * (postScores.anger || 0) * 0.8 +
      fear * (postScores.fear || 0) * 0.7;

    const rawScore =
      calmingBridge * 0.55 +
      empatheticSadness * 0.35 +
      gentleJoy * 0.25 -
      echoPenalty;
    return this.clamp(rawScore);
  }

  // =========================
  // CACHE
  // =========================

  private getCacheKey(userId: string): string {
    return `cache:emotion:features:${userId}`;
  }

  private async getCachedFeatures(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    const cached = await this.redis.get(this.getCacheKey(userId));
    if (!cached) return null;

    try {
      return this.normalizeFeatures(JSON.parse(cached));
    } catch {
      return null;
    }
  }

  private async cacheFeatures(
    userId: string,
    features: EmotionRankingFeaturesDto,
  ): Promise<void> {
    await this.redis.setex(
      this.getCacheKey(userId),
      CACHE_TTL_SECONDS,
      JSON.stringify(features),
    );
  }

  // =========================
  // FETCH
  // =========================

  private async fetchFromAnalysisService(
    userId: string,
  ): Promise<EmotionRankingFeaturesDto | null> {
    try {
      const response = await firstValueFrom(
        this.emotionIntelligenceClient.send("get_emotion_ranking_features", {
          userId,
        }),
      );

      this.logger.debug(
        `Received response from emotion intelligence service for user ${userId}: ${JSON.stringify(response)}`,
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
  // NORMALIZATION
  // =========================

  private normalizeFeatures(
    input: Partial<EmotionRankingFeaturesDto>,
  ): EmotionRankingFeaturesDto {
    return {
      userEmotionPreference: this.normalizeProbabilityMap(
        input.userEmotionPreference,
      ),
      last24hEmotionDistribution: this.normalizeNonNegativeMap(
        input.last24hEmotionDistribution,
      ),
      negativeRatio7d: this.clamp(input.negativeRatio7d ?? 0),
      emotionVolatility7d: this.clamp(input.emotionVolatility7d ?? 0),
      riskScore: this.clamp(input.riskScore ?? 0),
      recentNegativityScore: this.clamp(input.recentNegativityScore ?? 0),
      emotionMomentum: this.clampSigned(input.emotionMomentum ?? 0),
    };
  }

  private normalizeProbabilityMap(
    map?: Record<string, number>,
  ): Record<string, number> {
    if (!map) return {};

    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(map)) {
      const safeValue = Number.isFinite(value) ? Number(value) : 0;
      normalized[key] = this.clamp(safeValue);
    }
    return normalized;
  }

  private normalizeNonNegativeMap(
    map?: Record<string, number>,
  ): Record<string, number> {
    if (!map) return {};

    const normalized: Record<string, number> = {};
    for (const [key, value] of Object.entries(map)) {
      const safeValue = Number.isFinite(value) ? Number(value) : 0;
      normalized[key] = Math.max(0, safeValue);
    }
    return normalized;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  private clampSigned(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  // =========================
  // AUXILIARY SCORING
  // =========================

  private calcNoveltyScore(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    let score = 0;
    const exposure = features.last24hEmotionDistribution || {};

    for (const emotion in postScores) {
      const postEmotion = postScores[emotion] || 0;
      const exposureRate = exposure[emotion] || 0;

      score += postEmotion * (1 - exposureRate);
    }

    return this.clamp(score);
  }

  private calcRiskPenalty(
    features: EmotionRankingFeaturesDto,
    postScores: Record<string, number>,
  ): number {
    const distress = this.calcDistress(features);

    const negative =
      (postScores.sadness || 0) * 0.4 +
      (postScores.anger || 0) * 0.3 +
      (postScores.fear || 0) * 0.3;

    return this.clamp(distress * Math.pow(negative, 2));
  }
}
