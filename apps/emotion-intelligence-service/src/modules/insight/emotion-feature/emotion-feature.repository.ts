import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
import { EmotionTimeWindow, RiskLevel } from '@repo/dtos';
import {
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';

export interface ProfileProjection {
  emotionVectorEMA?: Record<string, number>;
  decayedNegativityScore?: number;
  emotionMomentum?: number;
}

export interface SnapshotProjection {
  negativeRatio?: number;
  emotionVolatility?: number;
  riskScore?: number;
  emotionDistribution?: Record<string, number>;
  trend?: number;
}

@Injectable()
export class EmotionFeatureRepository {
  constructor(
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,

    @InjectModel(UserEmotionSnapshot.name)
    private readonly snapshotModel: Model<UserEmotionSnapshotDocument>,

    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly aggregateModel: Model<EmotionAnalyticsSnapshotDocument>,

    @InjectModel(UserRiskState.name)
    private readonly riskModel: Model<UserRiskStateDocument>,
  ) {}

  // ===== PROFILE =====
  async findProfileByUserId(userId: string): Promise<ProfileProjection | null> {
    return this.profileModel
      .findOne(
        { userId },
        {
          _id: 0,
          emotionVectorEMA: 1,
          recentNegativityScore: 1,
          emotionMomentum: 1,
        },
      )
      .lean<ProfileProjection>()
      .exec();
  }

  // ===== SNAPSHOT =====
  async getLatestSnapshot(
    userId: string,
    window: EmotionTimeWindow,
  ): Promise<SnapshotProjection | null> {
    return this.snapshotModel
      .findOne(
        { userId, window },
        {
          _id: 0,
          negativeRatio: 1,
          emotionVolatility: 1,
          riskScore: 1,
          emotionDistribution: 1,
          trend: 1,
        },
      )
      .sort({ createdAt: -1 })
      .lean<SnapshotProjection>()
      .exec();
  }

  async getLatestSnapshots(userId: string): Promise<{
    snapshot1d: SnapshotProjection | null;
    snapshot7d: SnapshotProjection | null;
  }> {
    const [snapshot1d, snapshot7d] = await Promise.all([
      this.getLatestSnapshot(userId, EmotionTimeWindow.ONE_DAY),
      this.getLatestSnapshot(userId, EmotionTimeWindow.SEVEN_DAYS),
    ]);

    return {
      snapshot1d,
      snapshot7d,
    };
  }

  // ===== (OPTIONAL) RAW AGGREGATES – giữ lại nếu cần debug/realtime =====
  async findAggregatesByUserIdInRange(
    userId: string,
    startTime: Date,
    endTime: Date,
  ) {
    return this.aggregateModel
      .find(
        {
          userId,
          createdAt: {
            $gte: startTime,
            $lte: endTime,
          },
        },
        {
          _id: 0,
          finalScores: 1,
        },
      )
      .lean()
      .exec();
  }

  async findRiskState(userId: string): Promise<{
    riskLevel?: RiskLevel;
    riskScore?: number;
  } | null> {
    return this.riskModel
      .findOne(
        { userId },
        {
          _id: 0,
          riskLevel: 1,
          riskScore: 1,
        },
      )
      .lean()
      .exec();
  }
}
