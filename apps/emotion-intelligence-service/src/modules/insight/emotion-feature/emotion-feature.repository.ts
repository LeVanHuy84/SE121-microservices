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

interface SnapshotProjection {
  window?: string;
  negativeRatio?: number;
  emotionVolatility?: number;
  riskScore?: number;
}

export interface ProfileWithSnapshotsProjection {
  emotionVectorEMA?: Record<string, number>;
  recentNegativityScore?: number;
  emotionMomentum?: number;
  snapshot7d?: SnapshotProjection;
}

export interface Aggregate24hProjection {
  finalScores?: Record<string, number>;
}

@Injectable()
export class EmotionFeatureRepository {
  constructor(
    @InjectModel(UserEmotionProfile.name)
    private readonly profileModel: Model<UserEmotionProfileDocument>,
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly aggregateModel: Model<EmotionAnalyticsSnapshotDocument>,
  ) {}

  async findProfileWithSnapshotsByUserId(
    userId: string,
  ): Promise<ProfileWithSnapshotsProjection | null> {
    const pipeline: Record<string, unknown>[] = [
      { $match: { userId } },
      {
        $lookup: {
          from: 'user_emotion_snapshots',
          let: { userId: '$userId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$userId', '$$userId'] },
                    { $eq: ['$window', '7d'] },
                  ],
                },
              },
            },
            { $sort: { createdAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                window: 1,
                negativeRatio: 1,
                emotionVolatility: 1,
                riskScore: 1,
              },
            },
          ],
          as: 'snapshot7dCandidates',
        },
      },
      {
        $addFields: {
          snapshot7d: { $arrayElemAt: ['$snapshot7dCandidates', 0] },
        },
      },
      {
        $project: {
          _id: 0,
          emotionVectorEMA: 1,
          recentNegativityScore: 1,
          emotionMomentum: 1,
          snapshot7d: 1,
        },
      },
      { $limit: 1 },
    ];

    const rows = await this.profileModel
      .aggregate<ProfileWithSnapshotsProjection>(pipeline as any)
      .exec();

    return rows[0] ?? null;
  }

  async findAggregatesByUserIdInRange(
    userId: string,
    startTime: Date,
    endTime: Date,
  ): Promise<Aggregate24hProjection[]> {
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
      .lean<Aggregate24hProjection[]>()
      .exec();
  }
}
