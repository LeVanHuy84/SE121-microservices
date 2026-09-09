import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TargetType } from '@repo/dtos';
import { Model } from 'mongoose';
import {
  EmotionAnalyticsSnapshot,
  EmotionAnalyticsSnapshotDocument,
} from 'src/mongo/schema/analytic-snapshot.schema';

@Injectable()
export class EmotionAnalyticsRepository {
  constructor(
    @InjectModel(EmotionAnalyticsSnapshot.name)
    private readonly analyticsModel: Model<EmotionAnalyticsSnapshotDocument>,
  ) {}

  async findLatestByTarget(
    userId: string,
    targetId: string,
    targetType: TargetType,
  ): Promise<EmotionAnalyticsSnapshot | null> {
    return this.analyticsModel
      .findOne({
        userId,
        targetId,
        targetType,
      })
      .sort({ createdAt: -1 })
      .lean<EmotionAnalyticsSnapshot>();
  }
}
