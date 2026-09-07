import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EmotionTimeWindow, RiskLevel } from '@repo/dtos';
import { Model } from 'mongoose';
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

export interface Snapshot1dProjection {
  riskScore?: number;
  negativeRatio?: number;
  emotionVolatility?: number;
  trend?: number;
  baselineNegativeRatio?: number;
  createdAt?: Date;
}

export interface ProfileSpikeProjection {
  decayedNegativityScore?: number;
  consecutiveNegativeDays?: number;
  emotionMomentum?: number;
  lastEventAt?: Date;
  lastStrongNegativeAt?: Date;
}

export interface RiskStateProjection {
  userId: string;
  riskLevel: RiskLevel;
  riskScore: number;
  stableWindows: number;
  previousRiskScore: number;
  lastNotifiedAt?: Date;
  lastEvaluatedAt?: Date;
}

@Injectable()
export class WarningRepository {
  constructor(
    @InjectModel(UserEmotionSnapshot.name)
    private readonly snapshotModel: Model<UserEmotionSnapshotDocument>,
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
  ) {}

  async findLatestSnapshot1d(
    userId: string,
  ): Promise<Snapshot1dProjection | null> {
    return this.snapshotModel
      .findOne(
        {
          userId,
          window: EmotionTimeWindow.ONE_DAY,
        },
        {
          _id: 0,
          riskScore: 1,
          negativeRatio: 1,
          emotionVolatility: 1,
          trend: 1,
          baselineNegativeRatio: 1,
          createdAt: 1,
        },
      )
      .sort({ createdAt: -1 })
      .lean<Snapshot1dProjection>()
      .exec();
  }

  async findProfileSignals(
    userId: string,
  ): Promise<ProfileSpikeProjection | null> {
    return this.profileModel
      .findOne(
        { userId },
        {
          _id: 0,
          decayedNegativityScore: 1,
          consecutiveNegativeDays: 1,
          emotionMomentum: 1,
          lastEventAt: 1,
          lastStrongNegativeAt: 1,
        },
      )
      .lean<ProfileSpikeProjection>()
      .exec();
  }

  async findRiskState(userId: string): Promise<RiskStateProjection | null> {
    return this.riskStateModel
      .findOne(
        { userId },
        {
          _id: 0,
          userId: 1,
          riskLevel: 1,
          riskScore: 1,
          stableWindows: 1,
          previousRiskScore: 1,
          lastNotifiedAt: 1,
          lastEvaluatedAt: 1,
        },
      )
      .lean<RiskStateProjection>()
      .exec();
  }

  async upsertRiskState(
    userId: string,
    payload: Omit<RiskStateProjection, 'userId'>,
  ): Promise<void> {
    await this.riskStateModel.updateOne(
      { userId },
      {
        $set: {
          userId,
          ...payload,
        },
      },
      { upsert: true },
    );
  }
}
