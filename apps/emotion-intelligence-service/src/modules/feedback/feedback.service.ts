import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import {
  CreateFeedbackDto,
  Emotion,
  FeedbackResponseDto,
  TargetType,
} from '@repo/dtos';
import { FeedbackRepository } from './feedback.repository';
import { EmotionAnalyticsRepository } from '../emotion-analytics/emotion-analytics.repository';
import { EmotionFeedback } from 'src/mongo/schema/emotion-feedback.schema';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly feedbackRepository: FeedbackRepository,
    private readonly analyticsRepository: EmotionAnalyticsRepository,
  ) {}

  async createFeedback(
    userId: string,
    data: CreateFeedbackDto,
  ): Promise<FeedbackResponseDto> {
    const { targetId, targetType, isAccurate, expectedEmotion } = data;

    // Validate input
    if (!targetId || !targetType) {
      throw new BadRequestException('targetId and targetType are required');
    }

    // Fetch latest emotion snapshot
    const snapshot = await this.analyticsRepository.findLatestByTarget(
      userId,
      targetId,
      targetType,
    );

    if (!snapshot) {
      throw new NotFoundException(
        `Emotion analysis not found for target: ${targetId}`,
      );
    }

    // Extract snapshot data
    const { finalEmotion, finalConfidence, modelVersion } = snapshot;

    // Create feedback data
    const feedbackData = {
      userId,
      targetId,
      targetType,
      isAccurate,
      expectedEmotion,
      predictedEmotion: finalEmotion.toUpperCase() as Emotion,
      confidence: finalConfidence,
      modelVersion: modelVersion ?? 'unknown',
    };

    // Save feedback
    const feedback = await this.feedbackRepository.createFeedback(feedbackData);

    return this.mapToDto(feedback);
  }

  async getFeedbackByTarget(
    userId: string,
    targetId: string,
    targetType: TargetType,
  ): Promise<FeedbackResponseDto[]> {
    const feedbacks = await this.feedbackRepository.findByTarget(
      userId,
      targetId,
      targetType,
    );

    return feedbacks.map((feedback) => this.mapToDto(feedback));
  }

  private mapToDto(feedback: EmotionFeedback): FeedbackResponseDto {
    return {
      id: feedback._id?.toString() || '',
      targetId: feedback.targetId,
      targetType: feedback.targetType,
      isAccurate: feedback.isAccurate,
      expectedEmotion: feedback.expectedEmotion,
      predictedEmotion: feedback.predictedEmotion,
      confidence: feedback.confidence,
      modelVersion: feedback.modelVersion,
      createdAt: feedback.createdAt,
    };
  }
}
