import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EmotionTimeWindow } from '@repo/dtos';
import { Model } from 'mongoose';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotDocument,
} from 'src/mongo/schema/analytic-snapshot.schema';
import {
  UserEmotionSnapshot,
  UserEmotionSnapshotDocument,
} from 'src/mongo/schema/emotion-snapshot.schema';
import { SnapshotAggregateEvent, SnapshotPayload } from './snapshot.schema';

@Injectable()
export class SnapshotRepository {
  constructor(
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly aggregateModel: Model<EmotionAnalyticsSnapshotDocument>,
    @InjectModel(UserEmotionSnapshot.name)
    private readonly snapshotModel: Model<UserEmotionSnapshotDocument>,
  ) {}

  async getAggregatesByUserSince(
    userId: string,
    since: Date,
    until: Date,
  ): Promise<SnapshotAggregateEvent[]> {
    return this.aggregateModel
      .find(
        {
          userId,
          createdAt: {
            $gte: since,
            $lte: until,
          },
        },
        {
          _id: 0,
          createdAt: 1,
          finalEmotion: 1,
          finalScores: 1,
        },
      )
      .sort({ createdAt: 1 })
      .lean<SnapshotAggregateEvent[]>()
      .exec();
  }

  // async getUsersWithAggregatesBetween(
  //   since: Date,
  //   until: Date,
  // ): Promise<string[]> {
  //   return this.aggregateModel
  //     .distinct('userId', {
  //       createdAt: {
  //         $gt: since,
  //         $lte: until,
  //       },
  //     })
  //     .exec();
  // }

  async upsertUserWindowSnapshot(
    userId: string,
    window: EmotionTimeWindow,
    payload: SnapshotPayload,
  ): Promise<void> {
    await this.snapshotModel.updateOne(
      {
        userId,
        window,
      },
      {
        $set: payload,
      },
      { upsert: true },
    );
  }

  async insertSnapshot(payload: SnapshotPayload): Promise<void> {
    await this.snapshotModel.create(payload);
  }

  async getLatestSnapshot(
    userId: string,
    window: EmotionTimeWindow,
  ): Promise<UserEmotionSnapshot | null> {
    return this.snapshotModel
      .findOne({ userId, window })
      .sort({ createdAt: -1 })
      .lean<UserEmotionSnapshot>()
      .exec();
  }

  async getPreviousSnapshot(
    userId: string,
    window: EmotionTimeWindow,
  ): Promise<UserEmotionSnapshot | null> {
    const snapshots = await this.snapshotModel
      .find({ userId, window })
      .sort({ createdAt: -1 })
      .skip(1)
      .limit(1)
      .lean<UserEmotionSnapshot[]>()
      .exec();

    return snapshots[0] ?? null;
  }

  async getUserWindowSnapshot(
    userId: string,
    window: EmotionTimeWindow,
  ): Promise<UserEmotionSnapshot | null> {
    return this.getLatestSnapshot(userId, window);
  }

  // ===== SEED =====
  async getEarliestEventTime(userId: string): Promise<Date | null> {
    const doc = await this.aggregateModel
      .findOne({ userId }, { createdAt: 1 })
      .sort({ createdAt: 1 })
      .lean<{ createdAt: Date }>()
      .exec();

    return doc?.createdAt ?? null;
  }
}
