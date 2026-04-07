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
  recentNegativityScore?: number;
  negativeEventStreak?: number;
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
          recentNegativityScore: profileRaw.recentNegativityScore ?? 0,
          negativeEventStreak: profileRaw.negativeEventStreak ?? 0,
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
}
