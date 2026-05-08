import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { TargetType } from '@repo/dtos';
import { Model } from 'mongoose';
import {
  EmotionFeedback,
  EmotionFeedbackDocument,
} from 'src/mongo/schema/emotion-feedback.schema';

export interface CreateFeedbackData {
  userId: string;
  targetId: string;
  targetType: TargetType;
  isAccurate: boolean;
  expectedEmotion?: string;
  predictedEmotion: string;
  confidence: number;
  modelVersion: string;
  note?: string;
}

@Injectable()
export class FeedbackRepository {
  constructor(
    @InjectModel(EmotionFeedback.name)
    private readonly feedbackModel: Model<EmotionFeedbackDocument>,
  ) {}

  async createFeedback(data: CreateFeedbackData): Promise<EmotionFeedback> {
    const feedback = new this.feedbackModel(data);
    return feedback.save();
  }

  async findByTarget(
    userId: string,
    targetId: string,
    targetType: TargetType,
  ): Promise<EmotionFeedback[]> {
    return this.feedbackModel
      .find({
        userId,
        targetId,
        targetType,
      })
      .sort({ createdAt: -1 })
      .lean<EmotionFeedback[]>();
  }

  async findByUserId(userId: string): Promise<EmotionFeedback[]> {
    return this.feedbackModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean<EmotionFeedback[]>();
  }

  async listFeedbacks(
    page = 1,
    limit = 20,
    isAccurate?: boolean,
  ): Promise<{
    items: EmotionFeedback[];
    total: number;
    page: number;
    limit: number;
  }> {
    const query: any = {};
    if (isAccurate !== undefined) query.isAccurate = isAccurate;

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.feedbackModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean<EmotionFeedback[]>()
        .exec(),
      this.feedbackModel.countDocuments(query).exec(),
    ]);

    return { items, total, page, limit };
  }

  async accuracySummary(): Promise<{
    totalFeedbacks: number;
    accurateCount: number;
    inaccurateCount: number;
    accuracyRate: number;
    topMismatchPairs: { predicted: string; expected: string; count: number }[];
  }> {
    const [totalFeedbacks, accurateCount] = await Promise.all([
      this.feedbackModel.countDocuments().exec(),
      this.feedbackModel.countDocuments({ isAccurate: true }).exec(),
    ]);

    const inaccurateCount = totalFeedbacks - accurateCount;
    const accuracyRate =
      totalFeedbacks > 0 ? accurateCount / totalFeedbacks : 0;

    const mismatches = await this.feedbackModel
      .aggregate([
        { $match: { isAccurate: false, expectedEmotion: { $exists: true } } },
        {
          $group: {
            _id: {
              predicted: '$predictedEmotion',
              expected: '$expectedEmotion',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            _id: 0,
            predicted: '$_id.predicted',
            expected: '$_id.expected',
            count: 1,
          },
        },
      ])
      .exec();

    return {
      totalFeedbacks,
      accurateCount,
      inaccurateCount,
      accuracyRate,
      topMismatchPairs: mismatches,
    };
  }
}
