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
  UserRiskState,
  UserRiskStateDocument,
} from 'src/mongo/schema/user_risk_states.schema';
import { ProfileAggregateEvent } from './profile.schema';
import { RiskUserItemDto } from '@repo/dtos';

@Injectable()
export class ProfileRepository {
  constructor(
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly aggregateModel: Model<EmotionAnalyticsSnapshotDocument>,
    @InjectModel(UserRiskState.name)
    private readonly riskStateModel: Model<UserRiskStateDocument>,
  ) {}

  async getByUserId(userId: string): Promise<UserEmotionProfile> {
    const profile = await this.profileModel
      .findOne({ userId })
      .lean<UserEmotionProfileDocument>()
      .exec();

    if (!profile) {
      return this.buildDefaultProfile(userId);
    }

    return profile;
  }

  async listRiskUsers(
    page = 1,
    limit = 20,
    riskLevel?: string,
  ): Promise<{
    items: RiskUserItemDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query: any = {};
    if (riskLevel) query.riskLevel = riskLevel;

    const skip = (page - 1) * limit;

    const [itemsRaw, total] = await Promise.all([
      this.riskStateModel
        .find(query)
        .sort({ riskScore: -1 })
        .skip(skip)
        .limit(limit)
        .lean<any[]>()
        .exec(),
      this.riskStateModel.countDocuments(query).exec(),
    ]);

    const userIds = itemsRaw.map((r) => r.userId);
    const profiles = await this.profileModel
      .find({ userId: { $in: userIds } })
      .lean<any[]>()
      .exec();

    const profileById = new Map(profiles.map((p) => [p.userId, p]));

    // compute signal counts per user from analytics snapshots (privacy-safe numeric only)
    const counts = await this.aggregateModel
      .aggregate([
        { $match: { userId: { $in: userIds } } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ])
      .exec();

    const countById = new Map(counts.map((c: any) => [c._id, c.count]));

    const items: RiskUserItemDto[] = itemsRaw.map((r) => ({
      userId: r.userId,
      riskLevel: r.riskLevel,
      riskScore: r.riskScore,
      signalCount: Number(countById.get(r.userId) ?? 0),
      updatedAt: r.updatedAt,
      flagged: !!r.flagged,
    }));

    return { items, total, page, limit };
  }

  async getRiskStateByUserId(userId: string) {
    return this.riskStateModel.findOne({ userId }).lean().exec();
  }

  async upsert(
    userId: string,
    payload: Partial<UserEmotionProfile>,
  ): Promise<void> {
    const {
      negativeEventStreak,
      lastEventAt,
      lastStrongNegativeAt,
      recentNegativityScore,
      emotionMomentum,
      ...restPayload
    } = payload;

    await this.profileModel.updateOne(
      { userId },
      {
        $set: {
          ...restPayload,
          userId,
          ...(negativeEventStreak !== undefined && { negativeEventStreak }),
          ...(lastEventAt !== undefined && { lastEventAt }),
          ...(lastStrongNegativeAt !== undefined && { lastStrongNegativeAt }),
          ...(recentNegativityScore !== undefined && { recentNegativityScore }),
          ...(emotionMomentum !== undefined && { emotionMomentum }),
        },
        $setOnInsert: {
          ...(negativeEventStreak === undefined && { negativeEventStreak: 0 }),
          ...(recentNegativityScore === undefined && {
            recentNegativityScore: 0,
          }),
          ...(emotionMomentum === undefined && { emotionMomentum: 0 }),
          ...(lastEventAt === undefined && { lastEventAt: null }),
          ...(lastStrongNegativeAt === undefined && {
            lastStrongNegativeAt: null,
          }),
        },
      },
      { upsert: true },
    );
  }

  async getAggregatesByUserAfter(
    userId: string,
    start: Date | undefined,
    end: Date,
  ): Promise<ProfileAggregateEvent[]> {
    const createdAtFilter = start
      ? {
          $gt: start,
          $lte: end,
        }
      : {
          $lte: end,
        };

    return this.aggregateModel
      .find(
        {
          userId,
          createdAt: createdAtFilter,
        },
        {
          _id: 0,
          createdAt: 1,
          finalEmotion: 1,
          finalScores: 1,
        },
      )
      .sort({ createdAt: 1 })
      .lean<ProfileAggregateEvent[]>()
      .exec();
  }

  private buildDefaultProfile(userId: string): UserEmotionProfile {
    return {
      userId,
      emotionVectorEMA: {
        joy: 0.25,
        sadness: 0.1,
        anger: 0.1,
        fear: 0.1,
        disgust: 0.05,
        surprise: 0.1,
        neutral: 0.3,
      },
      recentNegativityScore: 0,
      negativeEventStreak: 0,
      lastEventAt: undefined,
      lastStrongNegativeAt: undefined,
      emotionMomentum: 0,
    };
  }
}
