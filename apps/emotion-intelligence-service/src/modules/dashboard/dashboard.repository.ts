import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DashboardOverviewResponseDto,
  Emotion,
  EmotionTimeWindow,
  MentalHealthRiskLevel,
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
  InterventionResource,
  InterventionResourceDocument,
} from 'src/mongo/schema/intervention-resource.schema';
import {
  EmergencyHotline,
  EmergencyHotlineDocument,
} from 'src/mongo/schema/emergency-hotline.schema';
import {
  InterventionLog,
  InterventionLogDocument,
} from 'src/mongo/schema/intervention-log.schema';
import {
  EmotionFeedback,
  EmotionFeedbackDocument,
} from 'src/mongo/schema/emotion-feedback.schema';
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
  joy: number;
  happy?: number;
  sadness: number;
  sad?: number;
  anger: number;
  angry?: number;
  fear: number;
  disgust: number;
  surprise: number;
  neutral: number;
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
    @InjectModel(InterventionResource.name)
    private readonly resourceModel: Model<InterventionResourceDocument>,
    @InjectModel(EmergencyHotline.name)
    private readonly hotlineModel: Model<EmergencyHotlineDocument>,
    @InjectModel(InterventionLog.name)
    private readonly interventionLogModel: Model<InterventionLogDocument>,
    @InjectModel(EmotionFeedback.name)
    private readonly feedbackModel: Model<EmotionFeedbackDocument>,
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
  async getOverview(): Promise<DashboardOverviewResponseDto> {
    const WINDOW_DAYS = 30;
    const windowStartDate = new Date(
      Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [
      totalSnapshots,
      totalInterventions,
      activeResourcesCount,
      totalResourcesCount,
      activeHotlinesCount,
      totalHotlinesCount,
      feedbackStats,
      emotionStats,
      riskStats,
      targetTypeStats,
    ] = await Promise.all([
      this.analyticsSnapshotModel.countDocuments().exec(),
      this.interventionLogModel.countDocuments().exec(),
      this.resourceModel.countDocuments({ isActive: true }).exec(),
      this.resourceModel.countDocuments().exec(),
      this.hotlineModel.countDocuments({ isActive: true }).exec(),
      this.hotlineModel.countDocuments().exec(),
      this.feedbackModel
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              accurate: {
                $sum: { $cond: [{ $eq: ['$isAccurate', true] }, 1, 0] },
              },
            },
          },
        ])
        .exec(),
      // Emotion distribution in the last 30 days
      this.analyticsSnapshotModel
        .aggregate([
          {
            $match: {
              createdAt: { $gte: windowStartDate },
            },
          },
          {
            $group: {
              _id: {
                $toLower: {
                  $ifNull: ['$primaryEmotion', '$finalEmotion'],
                },
              },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      // Current risk level state distribution of users
      this.riskStateModel
        .aggregate([
          {
            $group: {
              _id: { $toLower: '$riskLevel' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
      // Content target type distribution (Posts & Comments only in the last 30 days)
      this.analyticsSnapshotModel
        .aggregate([
          {
            $match: {
              createdAt: { $gte: windowStartDate },
              targetType: {
                $in: [
                  TargetType.POST,
                  TargetType.COMMENT,
                  'POST',
                  'COMMENT',
                  'post',
                  'comment',
                ],
              },
            },
          },
          {
            $group: {
              _id: { $toLower: '$targetType' },
              count: { $sum: 1 },
            },
          },
        ])
        .exec(),
    ]);

    // 1. Feedback dispute/reporting rate
    const totalFeedbacks = feedbackStats?.[0]?.total ?? 0;
    const accurateCount = feedbackStats?.[0]?.accurate ?? 0;
    const aiAccuracyRate =
      totalFeedbacks > 0 ? accurateCount / totalFeedbacks : 0;
    const feedbackRate =
      totalSnapshots > 0
        ? Number((totalFeedbacks / totalSnapshots).toFixed(4))
        : 0;

    // 2. Emotion distribution mapping (last 30 days)
    const emotionMap = {
      joy: 0,
      sadness: 0,
      anger: 0,
      fear: 0,
      disgust: 0,
      surprise: 0,
      neutral: 0,
    };
    let totalEmotionsCount = 0;
    for (const item of emotionStats) {
      const raw = (item._id || '').toLowerCase();
      const count = item.count || 0;
      totalEmotionsCount += count;
      if (raw === 'joy' || raw === 'happy') {
        emotionMap.joy += count;
      } else if (raw === 'sadness' || raw === 'sad') {
        emotionMap.sadness += count;
      } else if (raw === 'anger' || raw === 'angry') {
        emotionMap.anger += count;
      } else if (raw === 'fear') {
        emotionMap.fear += count;
      } else if (raw === 'disgust') {
        emotionMap.disgust += count;
      } else if (raw === 'surprise') {
        emotionMap.surprise += count;
      } else {
        emotionMap.neutral += count;
      }
    }

    // 3. Risk level distribution mapping
    const riskMap = {
      normal: 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };
    let totalRiskUsers = 0;
    for (const item of riskStats) {
      const raw = (item._id || '').toLowerCase();
      const count = item.count || 0;
      totalRiskUsers += count;
      if (raw === 'critical') {
        riskMap.critical += count;
      } else if (raw === 'high') {
        riskMap.high += count;
      } else if (raw === 'medium') {
        riskMap.medium += count;
      } else if (raw === 'low') {
        riskMap.low += count;
      } else {
        riskMap.normal += count;
      }
    }

    // 4. Target type distribution mapping (Posts & Comments only)
    const targetMap = {
      posts: 0,
      comments: 0,
      total: 0,
    };
    for (const item of targetTypeStats) {
      const raw = (item._id || '').toLowerCase();
      const count = item.count || 0;
      targetMap.total += count;
      if (raw.includes('comment')) {
        targetMap.comments += count;
      } else {
        targetMap.posts += count;
      }
    }

    return {
      totalAnalyzedSnapshots: totalSnapshots,
      totalInterventionsDispatched: totalInterventions,
      activeInterventionResources: activeResourcesCount + activeHotlinesCount,
      feedbackRate,
      aiAccuracyRate: Number(aiAccuracyRate.toFixed(4)),

      daysWindow: WINDOW_DAYS,
      emotionDistribution: {
        ...emotionMap,
        total: totalEmotionsCount,
      },
      riskDistribution: {
        ...riskMap,
        totalUsers: totalRiskUsers,
      },
      targetTypeDistribution: targetMap,
      resourceSummary: {
        totalHotlines: totalHotlinesCount,
        activeHotlines: activeHotlinesCount,
        totalExercises: totalResourcesCount,
        activeExercises: activeResourcesCount,
      },
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
            emotion: {
              $toLower: {
                $ifNull: ['$primaryEmotion', '$finalEmotion'],
              },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    // ===== GROUP MAP =====
    const grouped: Record<
      string,
      {
        joy: number;
        sadness: number;
        anger: number;
        fear: number;
        disgust: number;
        surprise: number;
        neutral: number;
      }
    > = {};

    for (const item of raw) {
      const day = item._id.day;
      if (!day) continue;

      const rawEmotion = (item._id.emotion || '').toLowerCase();

      let emotionKey:
        | 'joy'
        | 'sadness'
        | 'anger'
        | 'fear'
        | 'disgust'
        | 'surprise'
        | 'neutral' = 'neutral';

      if (rawEmotion === 'joy' || rawEmotion === 'happy') {
        emotionKey = 'joy';
      } else if (rawEmotion === 'sadness' || rawEmotion === 'sad') {
        emotionKey = 'sadness';
      } else if (rawEmotion === 'anger' || rawEmotion === 'angry') {
        emotionKey = 'anger';
      } else if (rawEmotion === 'fear') {
        emotionKey = 'fear';
      } else if (rawEmotion === 'disgust') {
        emotionKey = 'disgust';
      } else if (rawEmotion === 'surprise') {
        emotionKey = 'surprise';
      } else if (rawEmotion === 'neutral') {
        emotionKey = 'neutral';
      }

      if (!grouped[day]) {
        grouped[day] = {
          joy: 0,
          sadness: 0,
          anger: 0,
          fear: 0,
          disgust: 0,
          surprise: 0,
          neutral: 0,
        };
      }

      grouped[day][emotionKey] = (grouped[day][emotionKey] || 0) + item.count;
    }

    // ===== FILL MISSING DAYS =====
    const result: DashboardChartItemProjection[] = [];

    const cursor = new Date(startDt);

    while (cursor <= endDt) {
      const dayStr = cursor.toISOString().split('T')[0];
      const counts = grouped[dayStr] || {
        joy: 0,
        sadness: 0,
        anger: 0,
        fear: 0,
        disgust: 0,
        surprise: 0,
        neutral: 0,
      };

      result.push({
        date: dayStr,
        joy: counts.joy,
        happy: counts.joy,
        sadness: counts.sadness,
        sad: counts.sadness,
        anger: counts.anger,
        angry: counts.anger,
        fear: counts.fear,
        disgust: counts.disgust,
        surprise: counts.surprise,
        neutral: counts.neutral,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }
}
