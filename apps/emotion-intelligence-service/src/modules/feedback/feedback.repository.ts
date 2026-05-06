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
}
