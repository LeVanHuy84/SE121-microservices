import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, Logger } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  DashboardDistributionResponseDto,
  DashboardSummaryResponseDto,
  DashboardTrendPointDto,
  DashboardTrendResponseDto,
  DashboardInsightsResponseDto,
  EmotionTimeWindow,
  GetDashboardDistributionDto,
  GetDashboardTrendDto,
  RiskLevel,
  CursorPageResponse,
  EmotionHistoryItemDto,
  CursorPaginationDTO,
  InsightType,
  InsightTone,
} from '@repo/dtos';
import Redis from 'ioredis';
import { DashboardRepository } from './dashboard.repository';
import { InsightFacade } from '../insight/insight.facade';
import { InsightContext } from '../insight/insight.types';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly dashboardRepo: DashboardRepository,
    private readonly insightFacade: InsightFacade,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ================= SUMMARY =================
  async getSummary(userId: string): Promise<DashboardSummaryResponseDto> {
    const cacheKey = `dashboard:v1:summary:${userId}`;
    const cached = await this.getCached<DashboardSummaryResponseDto>(cacheKey);
    if (cached) return cached;

    const [riskState, profile, snapshots, trend1d] = await Promise.all([
      this.dashboardRepo.findRiskStateByUserId(userId),
      this.dashboardRepo.findProfileByUserId(userId),
      this.dashboardRepo.findSummarySnapshots(userId),

      // lấy 2 điểm để tính trend nhẹ
      this.dashboardRepo.findLatestSnapshots(
        userId,
        EmotionTimeWindow.ONE_DAY,
        2,
      ),
    ]);

    if (!riskState || !profile) {
      const fallback = this.buildDefaultSummary();
      await this.setCached(cacheKey, fallback, 60);
      return fallback;
    }

    const latest = trend1d?.[0];
    const prev = trend1d?.[1];

    const shortTermTrend = this.calcShortTermTrend(
      latest?.negativeRatio,
      prev?.negativeRatio,
    );

    const vsBaseline = this.calcVsBaseline(
      snapshots.snapshot1d?.negativeRatio,
      snapshots.snapshot30d?.baselineNegativeRatio,
    );

    const dominantEmotion = this.getDominantEmotion(profile.emotionVectorEMA);
    const negativityScore = Math.round(
      Number(snapshots.snapshot1d?.negativeRatio ?? 0) * 100,
    );

    const res: DashboardSummaryResponseDto = {
      riskLevel: riskState.riskLevel || RiskLevel.NORMAL,
      riskScore: Number(riskState.riskScore ?? 0),

      recentNegativityScore: Number(negativityScore),
      negativeEventStreak: Number(profile.consecutiveNegativeDays ?? 0),
      emotionMomentum: Number(profile.emotionMomentum ?? 0),

      lastEvaluatedAt: riskState.lastEvaluatedAt,

      dominantEmotion,
      shortTermTrend,
      vsBaseline,
    };

    await this.setCached(cacheKey, res, 60);
    return res;
  }

  // ================= TREND =================
  async getTrend(
    payload: GetDashboardTrendDto,
  ): Promise<DashboardTrendResponseDto> {
    const defaultLimit = this.getDefaultLimit(payload.window);

    const cacheKey = `dashboard:v1:trend:${payload.userId}:${payload.window}`;
    const cached = await this.getCached<DashboardTrendResponseDto>(cacheKey);
    if (cached) return cached;

    const snapshots = await this.dashboardRepo.findLatestSnapshots(
      payload.userId,
      payload.window,
      defaultLimit,
    );

    if (!snapshots.length) {
      return {
        data: [],
        current: 0,
        previous: null,
        trend: 0,
        baseline: 0,
      };
    }

    const latest = snapshots[0];
    const prev = snapshots[1] ?? null;

    const data: DashboardTrendPointDto[] = snapshots
      .slice()
      .reverse()
      .filter((s) => s.createdAt)
      .map((s) => ({
        timestamp: s.createdAt,
        negativeRatio: Number(s.negativeRatio ?? 0),
      }));

    const current = Number(latest.negativeRatio ?? 0);
    const previous = prev ? Number(prev.negativeRatio ?? 0) : null;

    const res: DashboardTrendResponseDto = {
      data,
      current,
      previous,
      trend: previous !== null ? current - previous : 0,
      baseline: Number(latest.baselineNegativeRatio ?? 0),
    };

    await this.setCached(cacheKey, res, 60);

    return res;
  }

  // ================= DISTRIBUTION =================
  async getDistribution(
    payload: GetDashboardDistributionDto,
  ): Promise<DashboardDistributionResponseDto> {
    const cacheKey = `dashboard:v1:distribution:${payload.userId}:${payload.window}`;

    const cached =
      await this.getCached<DashboardDistributionResponseDto>(cacheKey);

    if (cached) return cached;

    const snapshot = await this.dashboardRepo.findLatestSnapshotByWindow(
      payload.userId,
      payload.window,
    );

    if (!snapshot) {
      return {
        distribution: {},
        dominantEmotion: 'Chưa có dữ liệu',
      };
    }

    const raw = snapshot.emotionDistribution ?? {};

    const total = Object.values(raw).reduce(
      (sum, v) => sum + Number(v || 0),
      0,
    );

    const distribution =
      total > 0
        ? Object.fromEntries(
            Object.entries(raw).map(([k, v]) => [k, Number(v) / total]),
          )
        : {};

    const dominantEmotion =
      total > 0 ? this.pickDominantEmotion(distribution) : 'Chưa có dữ liệu';

    const res: DashboardDistributionResponseDto = {
      distribution,
      dominantEmotion,
    };

    await this.setCached(cacheKey, res, 120);

    return res;
  }

  async getInsights(userId: string): Promise<DashboardInsightsResponseDto> {
    const cacheKey = `dashboard:v1:insights:${userId}`;
    const cached = await this.getCached<DashboardInsightsResponseDto>(cacheKey);
    if (cached) return cached;

    const { profile, riskState, snapshot1d } =
      await this.dashboardRepo.getInsightsData(userId);

    if (!profile || !riskState || !snapshot1d) {
      this.logger.warn(`Insights fallback for user=${userId}`);

      const fallback: DashboardInsightsResponseDto = [
        {
          type: InsightType.STABLE_STATE,
          message: 'Chưa đủ dữ liệu để phân tích xu hướng cảm xúc',
          tone: InsightTone.NEUTRAL,
        },
      ];

      await this.setCached(cacheKey, fallback, 120);
      return fallback;
    }

    const context: InsightContext = {
      profile,
      riskState,
      snapshot1d,
    };

    const insights = this.insightFacade.generate(context);

    // drop priority
    const response = insights.map(({ priority, ...rest }) => rest);

    await this.setCached(cacheKey, response, 120);
    return response;
  }

  // ================= HISTORY =================
  async getHistory(
    userId: string,
    query: CursorPaginationDTO,
  ): Promise<CursorPageResponse<EmotionHistoryItemDto>> {
    const { limit = 10, cursor } = query;

    const raw = await this.dashboardRepo.findHistoryByUserCursor(
      userId,
      limit,
      cursor,
    );

    if (!raw || raw.length === 0) {
      return new CursorPageResponse([], null, false);
    }

    let hasNextPage = false;
    let items = raw;

    // limit + 1 pattern
    if (raw.length > limit) {
      hasNextPage = true;
      items = raw.slice(0, limit);
    }

    const data: EmotionHistoryItemDto[] = items.map((item) => ({
      targetId: item.targetId,
      targetType: item.targetType,
      finalEmotion: item.finalEmotion,
      finalConfidence: item.finalConfidence,
      riskHintLevel: item.riskHintLevel,
      createdAt: item.createdAt,
    }));

    const nextCursor = hasNextPage
      ? items[items.length - 1]._id.toString()
      : null;

    return new CursorPageResponse(data, nextCursor, hasNextPage);
  }

  // ================= DEFAULTS =================
  private buildDefaultSummary(): DashboardSummaryResponseDto {
    return {
      riskLevel: RiskLevel.NORMAL,
      riskScore: 0,

      recentNegativityScore: 0,
      negativeEventStreak: 0,
      emotionMomentum: 0,

      lastEvaluatedAt: undefined,

      dominantEmotion: undefined,
      shortTermTrend: undefined,
      vsBaseline: undefined,
    };
  }

  private getDominantEmotion(
    vector?: Record<string, number>,
  ): string | undefined {
    if (!vector) return undefined;

    return Object.entries(vector).sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  private calcShortTermTrend(
    current?: number,
    previous?: number,
  ): number | undefined {
    if (current == null || previous == null) return undefined;
    return Number((current - previous).toFixed(4));
  }

  private calcVsBaseline(
    current?: number,
    baseline?: number,
  ): number | undefined {
    if (current == null || baseline == null) return undefined;
    return Number((current - baseline).toFixed(4));
  }

  private getDefaultLimit(window: EmotionTimeWindow): number {
    switch (window) {
      case EmotionTimeWindow.ONE_DAY:
        return 24;
      case EmotionTimeWindow.SEVEN_DAYS:
        return 28;
      case EmotionTimeWindow.THIRTY_DAYS:
        return 30;
      default:
        return 24;
    }
  }

  private pickDominantEmotion(distribution: Record<string, number>): string {
    let max = Number.NEGATIVE_INFINITY;
    let emotion = '';

    for (const [k, v] of Object.entries(distribution)) {
      const val = Number(v);
      if (val > max) {
        max = val;
        emotion = k;
      }
    }

    return emotion;
  }

  // ================= CACHE =================
  private async getCached<T>(key: string): Promise<T | null> {
    try {
      const v = await this.redis.get(key);
      return v ? (JSON.parse(v) as T) : null;
    } catch (e) {
      this.logger.warn(`Cache read fail ${key}`);
      return null;
    }
  }

  private async setCached(key: string, value: unknown, ttl: number) {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (e) {
      this.logger.warn(`Cache write fail ${key}`);
    }
  }
}
