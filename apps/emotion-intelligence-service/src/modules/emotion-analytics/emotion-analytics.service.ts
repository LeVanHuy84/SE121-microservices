import { Injectable, NotFoundException } from '@nestjs/common';
import { TargetType, AnalysisSummaryDto } from '@repo/dtos';
import { EmotionAnalyticsRepository } from './emotion-analytics.repository';

@Injectable()
export class EmotionAnalyticsService {
  constructor(
    private readonly emotionAnalyticsRepository: EmotionAnalyticsRepository,
  ) {}

  async getByTarget(payload: {
    userId: string;
    targetId: string;
    targetType: TargetType;
  }): Promise<AnalysisSummaryDto> {
    const { userId, targetId, targetType } = payload;

    const snapshot = await this.emotionAnalyticsRepository.findLatestByTarget(
      userId,
      targetId,
      targetType,
    );

    if (!snapshot) {
      throw new NotFoundException('Emotion analysis not found');
    }

    return this.mapToDto(snapshot);
  }

  private mapToDto(snapshot: any): AnalysisSummaryDto {
    return {
      targetId: snapshot.targetId,
      targetType: snapshot.targetType,

      finalEmotion: snapshot.finalEmotion,
      finalScores: snapshot.finalScores,
      confidence: snapshot.finalConfidence,

      riskLevel: snapshot.riskHintLevel,

      createdAt: snapshot.createdAt,
    };
  }
}
