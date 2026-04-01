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
import { ProfileAggregateEvent } from './profile.schema';

@Injectable()
export class ProfileRepository {
  constructor(
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly aggregateModel: Model<EmotionAnalyticsSnapshotDocument>,
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
