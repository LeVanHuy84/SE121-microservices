import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Emotion,
  EmotionTimeWindow,
  RiskHintLevel,
  RiskLevel,
  TargetType,
} from '@repo/dtos';
import { Model, Types } from 'mongoose';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotDocument,
} from 'src/mongo/schema/analytic-snapshot.schema';
import {
  UserEmotionProfile,
  UserEmotionProfileDocument,
} from 'src/mongo/schema/emotion-profile.schema';
import {
  UserEmotionSnapshot,
  UserEmotionSnapshotDocument,
} from 'src/mongo/schema/emotion-snapshot.schema';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import {
  InsightProfileProjection,
  InsightRiskStateProjection,
  InsightSnapshotProjection,
} from '../insight/insight.types';

export interface DashboardRiskStateProjection {
  riskLevel?: RiskLevel;
  riskScore?: number;
  lastEvaluatedAt?: Date;
}

export interface DashboardProfileProjection {
  emotionVectorEMA?: Record<string, number>;
  decayedNegativityScore?: number;
  consecutiveNegativeDays?: number;
  lastStrongNegativeAt?: Date;
  emotionMomentum?: number;
}

export interface DashboardSnapshotProjection {
  createdAt: Date;
  negativeRatio?: number;
  baselineNegativeRatio?: number;
  emotionDistribution?: Record<string, number>;
  emotionVolatility?: number;
}

export interface DashboardHistoryProjection {
  _id: Types.ObjectId;
  targetId: string;
  targetType: TargetType;
  finalEmotion: Emotion;
  finalConfidence: number;
  riskHintLevel: RiskHintLevel;
  createdAt: Date;
}

export interface DashboardChartItemProjection {
  date: string;
  angry: number;
  disgust: number;
  fear: number;
  happy: number;
  neutral: number;
  sad: number;
  surprise: number;
}

@Injectable()
export class DashboardRepository {
  constructor(
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(UserEmotionSnapshot.name)
    private readonly snapshotModel: Model<UserEmotionSnapshotDocument>,
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly analyticsSnapshotModel: Model<EmotionAnalyticsSnapshotDocument>,
  ) {}

  // ===== SUMMARY =====
  async findRiskStateByUserId(
    userId: string,
  ): Promise<DashboardRiskStateProjection | null> {
    return this.riskStateModel
      .findOne(
        { userId },
        { _id: 0, riskLevel: 1, riskScore: 1, lastEvaluatedAt: 1 },
      )
      .lean<DashboardRiskStateProjection>()
      .exec();
  }

  async findProfileByUserId(
    userId: string,
  ): Promise<DashboardProfileProjection | null> {
    return this.profileModel
      .findOne(
        { userId },
        {
          _id: 0,
          emotionVectorEMA: 1,
          recentNegativityScore: 1,
          negativeEventStreak: 1,
          lastStrongNegativeAt: 1,
          emotionMomentum: 1,
        },
      )
      .lean<DashboardProfileProjection>()
      .exec();
  }

  // ===== SUMMARY SNAPSHOT =====
  async findSummarySnapshots(userId: string): Promise<{
    snapshot1d: DashboardSnapshotProjection | null;
    snapshot30d: DashboardSnapshotProjection | null;
  }> {
    const [snapshot1d, snapshot30d] = await Promise.all([
      this.snapshotModel
        .findOne(
          { userId, window: EmotionTimeWindow.ONE_DAY },
          {
            _id: 0,
            negativeRatio: 1,
            baselineNegativeRatio: 1,
            createdAt: 1,
          },
        )
        .sort({ createdAt: -1 })
        .lean<DashboardSnapshotProjection>()
        .exec(),

      this.snapshotModel
        .findOne(
          { userId, window: EmotionTimeWindow.THIRTY_DAYS },
          {
            _id: 0,
            negativeRatio: 1,
            baselineNegativeRatio: 1,
            createdAt: 1,
          },
        )
        .sort({ createdAt: -1 })
        .lean<DashboardSnapshotProjection>()
        .exec(),
    ]);

    return { snapshot1d, snapshot30d };
  }

  // ===== TREND =====
  async findLatestSnapshots(
    userId: string,
    window: EmotionTimeWindow,
    limit: number,
  ): Promise<DashboardSnapshotProjection[]> {
    return this.snapshotModel
      .find(
        { userId, window },
        {
          _id: 0,
          createdAt: 1,
          negativeRatio: 1,
          baselineNegativeRatio: 1,
        },
      )
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<DashboardSnapshotProjection[]>()
      .exec();
  }

  // ===== DISTRIBUTION =====
  async findLatestSnapshotByWindow(
    userId: string,
    window: EmotionTimeWindow,
  ): Promise<DashboardSnapshotProjection | null> {
    return this.snapshotModel
      .findOne(
        { userId, window },
        {
          _id: 0,
          emotionDistribution: 1,
        },
      )
      .sort({ createdAt: -1 })
      .lean<DashboardSnapshotProjection>()
      .exec();
  }

  // ===== INSIGHTS =====
  async getInsightsData(userId: string): Promise<{
    profile: InsightProfileProjection | null;
    riskState: InsightRiskStateProjection | null;
    snapshot1d: InsightSnapshotProjection | null;
  }> {
    const [profileRaw, riskRaw, snapshotRaw] = await Promise.all([
      this.profileModel
        .findOne(
          { userId },
          {
            _id: 0,
            recentNegativityScore: 1,
            negativeEventStreak: 1,
            emotionMomentum: 1,
            lastStrongNegativeAt: 1,
          },
        )
        .lean<DashboardProfileProjection>()
        .exec(),

      this.riskStateModel
        .findOne(
          { userId },
          {
            _id: 0,
            riskLevel: 1,
            riskScore: 1,
            previousRiskScore: 1, // 👈 FIX QUAN TRỌNG
          },
        )
        .lean<any>()
        .exec(),

      this.snapshotModel
        .findOne(
          { userId, window: EmotionTimeWindow.ONE_DAY },
          {
            _id: 0,
            emotionVolatility: 1,
            negativeRatio: 1,
            baselineNegativeRatio: 1,
            trend: 1,
          },
        )
        .sort({ createdAt: -1 })
        .lean<any>()
        .exec(),
    ]);

    const profile: InsightProfileProjection | null = profileRaw
      ? {
          decayedNegativityScore: profileRaw.decayedNegativityScore ?? 0,
          consecutiveNegativeDays: profileRaw.consecutiveNegativeDays ?? 0,
          emotionMomentum: profileRaw.emotionMomentum ?? 0,
          lastStrongNegativeAt: profileRaw.lastStrongNegativeAt,
        }
      : null;

    const riskState: InsightRiskStateProjection | null = riskRaw
      ? {
          riskLevel: riskRaw.riskLevel,
          riskScore: riskRaw.riskScore ?? 0,
          previousRiskScore: riskRaw.previousRiskScore ?? 0,
        }
      : null;

    const snapshot1d: InsightSnapshotProjection | null = snapshotRaw
      ? {
          emotionVolatility: snapshotRaw.emotionVolatility ?? 0,
          negativeRatio: snapshotRaw.negativeRatio ?? 0,
          baselineNegativeRatio: snapshotRaw.baselineNegativeRatio ?? 0,
          trend: snapshotRaw.trend ?? 0,
        }
      : null;

    return { profile, riskState, snapshot1d };
  }

  // ===== HISTORY (optional future) =====
  async findHistoryByUserCursor(
    userId: string,
    limit: number,
    cursor?: string, // ISO string của createdAt hoặc _id
  ): Promise<DashboardHistoryProjection[]> {
    const query: any = { userId };

    if (cursor) {
      query._id = { $lt: cursor }; // cursor-based theo ObjectId
    }

    return this.analyticsSnapshotModel
      .find(query, {
        _id: 1,
        targetId: 1,
        targetType: 1,
        finalEmotion: 1,
        finalConfidence: 1,
        riskHintLevel: 1,
        createdAt: 1,
      })
      .sort({ _id: -1 }) // 👈 quan trọng: sort theo _id để match cursor
      .limit(limit + 1) // 👈 lấy dư 1 để check hasNext
      .lean<DashboardHistoryProjection[]>()
      .exec();
  }

  // ===== ADMIN OVERVIEW =====
  async getOverview(): Promise<{
    totalAnalyzedSnapshots: number;
    highRiskUsers: number;
    criticalRiskUsers: number;
    averageNegativityScore: number;
    topEmotions: Record<string, number>;
  }> {
    const [totalSnapshots, highRiskUsers, criticalRiskUsers] =
      await Promise.all([
        this.analyticsSnapshotModel.countDocuments().exec(),
        this.riskStateModel
          .countDocuments({ riskLevel: RiskLevel.HIGH_RISK })
          .exec(),
        this.riskStateModel
          .countDocuments({ riskLevel: RiskLevel.CRISIS })
          .exec(),
      ]);

    // average negativity (across user snapshots)
    const avgRes = await this.snapshotModel
      .aggregate([{ $group: { _id: null, avg: { $avg: '$negativeRatio' } } }])
      .exec();

    const averageNegativityScore = (avgRes?.[0]?.avg ?? 0) as number;

    // top emotions distribution (by count)
    const dist = await this.analyticsSnapshotModel
      .aggregate([
        { $group: { _id: '$finalEmotion', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .exec();

    const topEmotions: Record<string, number> = {};
    for (const d of dist) {
      if (d._id) topEmotions[d._id] = d.count;
    }

    return {
      totalAnalyzedSnapshots: totalSnapshots,
      highRiskUsers,
      criticalRiskUsers,
      averageNegativityScore: Number(averageNegativityScore ?? 0),
      topEmotions,
    };
  }

  // ===== ADMIN DASHBOARD CHART =====
  async getDashboardChart(payload: {
    from?: string;
    to?: string;
  }): Promise<DashboardChartItemProjection[]> {
    const now = new Date();

    // ===== DEFAULT RANGE =====
    const toDate = payload.to ? new Date(payload.to) : now;

    const fromDate = payload.from
      ? new Date(payload.from)
      : new Date(toDate.getTime() - 6 * 24 * 60 * 60 * 1000);

    // ===== CLAMP RANGE =====
    const MAX_DAYS = 30;

    const diffDays =
      Math.floor(
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1;

    if (diffDays > MAX_DAYS) {
      fromDate.setTime(toDate.getTime() - (MAX_DAYS - 1) * 24 * 60 * 60 * 1000);
    }

    // normalize time
    const startDt = new Date(fromDate);
    startDt.setHours(0, 0, 0, 0);

    const endDt = new Date(toDate);
    endDt.setHours(23, 59, 59, 999);

    // ===== AGGREGATE =====
    const raw = await this.analyticsSnapshotModel.aggregate([
      {
        $match: {
          createdAt: {
            $gte: startDt,
            $lte: endDt,
          },
        },
      },

      {
        $group: {
          _id: {
            day: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            emotion: '$finalEmotion',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // ===== GROUP MAP =====
    const grouped: Record<string, Record<string, number>> = {};

    for (const item of raw) {
      const day = item._id.day;
      const emotion = item._id.emotion;

      if (!grouped[day]) {
        grouped[day] = {
          angry: 0,
          disgust: 0,
          fear: 0,
          happy: 0,
          neutral: 0,
          sad: 0,
          surprise: 0,
        };
      }

      grouped[day][emotion] = item.count;
    }

    // ===== FILL MISSING DAYS =====
    const result: DashboardChartItemProjection[] = [];

    const cursor = new Date(startDt);

    while (cursor <= endDt) {
      const dayStr = cursor.toISOString().split('T')[0];

      result.push({
        date: dayStr,

        angry: grouped[dayStr]?.angry ?? 0,
        disgust: grouped[dayStr]?.disgust ?? 0,
        fear: grouped[dayStr]?.fear ?? 0,
        happy: grouped[dayStr]?.happy ?? 0,
        neutral: grouped[dayStr]?.neutral ?? 0,
        sad: grouped[dayStr]?.sad ?? 0,
        surprise: grouped[dayStr]?.surprise ?? 0,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }
}
